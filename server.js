const express = require('express');
const axios = require('axios');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ⚙️ Express system parsers for reading form inputs and JSON data payloads
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 🎨 Tell Express to serve your static assets (CSS, images, frontend JS) out of public folder if you have one
app.use(express.static(path.join(__dirname, 'public')));

// 🗄️ Supabase Cloud Storage Engine Connection Initialization
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qzvjqhfhdrneaozmtlpi.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 📱 Safaricom M-Pesa Daraja Production API Credentials (Hardcoded from your repo setup)
const M_PESA_SHORTCODE = '9301663'; // Your verified Buy Goods Till Store Number
const M_PESA_CONSUMER_KEY = 'OtBDAcE3So3hwNr1xXIw9ux6apKRENUGQW02CDz8YU1C12yr';
const M_PESA_CONSUMER_SECRET = '17vNEaFA7JSqfzrPY2FMnGQGjg7rlz9QSRFJuK8KKPElbesIuSck9BXIvKa0OosO';

// =======================================================
// 🛠️ FIX: SERVE THE MAIN FRONTEND PAGE ROUTE
// =======================================================
app.get('/', (req, res) => {
    // This sends your plain index.html layout file directly to the web browser
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Helper Function: Generates the mandatory Safaricom OAuth Gateway Access Token
async function getMpesaToken() {
    const auth = Buffer.from(`${M_PESA_CONSUMER_KEY}:${M_PESA_CONSUMER_SECRET}`).toString('base64');
    try {
        const response = await axios.get('https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
            headers: { Authorization: `Basic ${auth}` }
        });
        return response.data.access_token;
    } catch (err) {
        console.error("Safaricom Token Generation Failed:", err.message);
        throw new Error("Failed to authenticate with Safaricom Developer API lines.");
    }
}

// =======================================================
// 💰 M-PESA STK PUSH TRIGGER ROUTE (Customer Buy Goods Online)
// =======================================================
app.post('/api/pay-unlock', async (req, res) => {
    let rawPhone = req.body.phone ? req.body.phone.trim() : '';
    if (!rawPhone) {
        return res.status(400).json({ success: false, error: "Phone number parameter is required." });
    }
    
    // Standardize local dial numbers to Kenya Country Code format (e.g. 07... to 2547...)
    rawPhone = rawPhone.replace(/\+/g, '');
    if (rawPhone.startsWith('0')) {
        rawPhone = '254' + rawPhone.substring(1);
    } else if (!rawPhone.startsWith('254')) {
        rawPhone = '254' + rawPhone;
    }
    
    const amount = 100; // Pricing setup to match your layout card
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14); // YYYYMMDDHHmmss
    
    // Grabs your secret passkey securely from Render's vault environment
    const passkey = process.env.M_PESA_PASSKEY; 
    if (!passkey || passkey.startsWith('PASTE_YOUR')) {
        return res.status(500).json({ success: false, error: "Server Configuration Error: Missing M_PESA_PASSKEY on Render Dashboard." });
    }

    // Encrypt security password sequence using standard Safaricom specification mapping
    const password = Buffer.from(`${M_PESA_SHORTCODE}${passkey}${timestamp}`).toString('base64');

    try {
        const token = await getMpesaToken();
        
        const payload = {
            BusinessShortCode: M_PESA_SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            TransactionType: "CustomerBuyGoodsOnline", // Explicit transaction type for Till Numbers
            Amount: amount,
            PartyA: rawPhone,
            PartyB: M_PESA_SHORTCODE, 
            PhoneNumber: rawPhone,
            CallBackURL: `https://${req.get('host')}/api/mpesa-callback`, // Dynamic webhook link matching host domain
            AccountReference: "Soulmate Premium Room",
            TransactionDesc: "Unlock Chat Application Systems Access"
        };

        const response = await axios.post('https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest', payload, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (response.data.ResponseCode === "0") {
            return res.status(200).json({ success: true, message: "STK PIN prompt triggered successfully!" });
        } else {
            return res.status(400).json({ success: false, error: "STK request rejected by network line." });
        }

    } catch (err) {
        console.error("STK Push Execution Error Logs:", err.response ? err.response.data : err.message);
        return res.status(500).json({ success: false, error: "Safaricom payment bridge gateway link timeout." });
    }
});

// =======================================================
// 📡 MPESA WEBHOOK CALLBACK LISTENER (Updates Supabase Data)
// =======================================================
app.post('/api/mpesa-callback', async (req, res) => {
    try {
        const callbackData = req.body.Body.stkCallback;
        console.log("Inbound Callback Verified:", JSON.stringify(callbackData));

        // ResultCode 0 explicitly means the user typed their true M-Pesa PIN and funds cleared!
        if (callbackData.ResultCode === 0) {
            const metaItems = callbackData.CallbackMetadata.Item;
            const phoneItem = metaItems.find(item => item.Name === 'PhoneNumber');
            const receiptItem = metaItems.find(item => item.Name === 'MpesaReceiptNumber');
            
            const cleanPhone = '0' + phoneItem.Value.toString().substring(3); // Normalizes back to 07... format
            const receiptCode = receiptItem.Value;

            // Direct data synchronization to update the database state row lines
            const { data, error } = await supabase
                .from('dating_users')
                .update({ 
                    is_premium_unlocked: true, 
                    mpesa_receipt: receiptCode 
                })
                .eq('phone', cleanPhone);
                
            if (error) throw error;
            console.log(`Database sync success. Profile ${cleanPhone} upgraded via receipt record ${receiptCode}.`);
        }
    } catch (err) {
        console.error("Background Webhook Database Writing Error:", err.message);
    }
    
    // Safaricom demands a fast HTTP 200 JSON receipt response status code to close transaction cycles
    res.status(200).json({ ResultCode: 0, ResultDesc: "Callback parsed successfully." });
});

// Execute and listen on server container deployment port
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running successfully on port ${PORT}`));
