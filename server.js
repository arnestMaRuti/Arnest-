const express = require('express');
const axios = require('axios');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ⚙️ Core body parsers to read JSON payloads and frontend forms
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 🎨 Serves fallback assets like images/CSS from the public folder if they exist
app.use(express.static(path.join(__dirname, 'public')));

// 🗄️ Supabase Production Cloud Database Client Connection 
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qzvjqhfhdrneaozmtlpi.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 📱 Safaricom M-Pesa Daraja Production API Credentials (Hardcoded Shortcode & Keys)
const M_PESA_SHORTCODE = '9301663'; // Your active Buy Goods Till Store Number
const M_PESA_CONSUMER_KEY = 'OtBDAcE3So3hwNr1xXIw9ux6apKRENUGQW02CDz8YU1C12yr';
const M_PESA_CONSUMER_SECRET = '17vNEaFA7JSqfzrPY2FMnGQGjg7rlz9QSRFJuK8KKPElbesIuSck9BXIvKa0OosO';

// =======================================================
// 🛠️ FIX: SERVE THE FRONTEND DIRECTLY FROM THE VIEWS FOLDER
// =======================================================
app.get('/', (req, res) => {
    // Correctly targets and streams index.html sitting inside your views subdirectory folder
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Helper Function: Requests the mandatory temporary OAuth authorization token handshake from Safaricom
async function getMpesaToken() {
    const auth = Buffer.from(`${M_PESA_CONSUMER_KEY}:${M_PESA_CONSUMER_SECRET}`).toString('base64');
    try {
        const response = await axios.get('https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
            headers: { Authorization: `Basic ${auth}` }
        });
        return response.data.access_token;
    } catch (err) {
        console.error("Safaricom API Authentication Failure:", err.message);
        throw new Error("Failed to clear authorization lines with Safaricom.");
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
    
    // Normalize format layout into standard Kenyan country code 254... strings
    rawPhone = rawPhone.replace(/\+/g, '');
    if (rawPhone.startsWith('0')) {
        rawPhone = '254' + rawPhone.substring(1);
    } else if (!rawPhone.startsWith('254')) {
        rawPhone = '254' + rawPhone;
    }
    
    const amount = 250; // Subscription cost threshold mapping
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14); // YYYYMMDDHHmmss
    
    // Pulls your secret passkey from your Render dashboard configuration environment vault
    const passkey = process.env.M_PESA_PASSKEY; 
    if (!passkey || passkey.startsWith('PASTE_YOUR')) {
        return res.status(500).json({ success: false, error: "Configuration Error: M_PESA_PASSKEY missing on Render environment settings." });
    }

    // Encrypts transaction sequence based on strict Daraja specifications
    const password = Buffer.from(`${M_PESA_SHORTCODE}${passkey}${timestamp}`).toString('base64');

    try {
        const token = await getMpesaToken();
        
        const payload = {
            BusinessShortCode: M_PESA_SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            TransactionType: "CustomerBuyGoodsOnline", // Explicit type for Buy Goods Till Number operations
            Amount: amount,
            PartyA: rawPhone,
            PartyB: M_PESA_SHORTCODE, 
            PhoneNumber: rawPhone,
            CallBackURL: `https://${req.get('host')}/api/mpesa-callback`, // Dynamic webhook listener pointing back to this exact server instance
            AccountReference: "Soulmate Premium Room",
            TransactionDesc: "Unlock Premium Chat Profile Browsing Sessions"
        };

        const response = await axios.post('https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest', payload, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (response.data.ResponseCode === "0") {
            return res.status(200).json({ success: true, message: "STK PIN prompt triggered out successfully!" });
        } else {
            return res.status(400).json({ success: false, error: "STK Push generation declined by Safaricom." });
        }

    } catch (err) {
        console.error("Daraja STK Push Core Error:", err.response ? err.response.data : err.message);
        return res.status(500).json({ success: false, error: "Safaricom Daraja network pipeline link timeout." });
    }
});

// =======================================================
// 📡 MPESA WEBHOOK CALLBACK LISTENER (Synchronizes states directly to Supabase)
// =======================================================
app.post('/api/mpesa-callback', async (req, res) => {
    try {
        const callbackData = req.body.Body.stkCallback;
        console.log("Inbound Confirmed Callback Payload:", JSON.stringify(callbackData));

        // ResultCode 0 explicitly means the user typed their correct PIN and payment cleared successfully!
        if (callbackData.ResultCode === 0) {
            const metaItems = callbackData.CallbackMetadata.Item;
            const phoneItem = metaItems.find(item => item.Name === 'PhoneNumber');
            const receiptItem = metaItems.find(item => item.Name === 'MpesaReceiptNumber');
            
            // Re-normalize number mapping to match your exact local database formats (e.g. 07...)
            const cleanPhone = '0' + phoneItem.Value.toString().substring(3); 
            const receiptCode = receiptItem.Value;

            // Direct data upgrade stream inside the newly generated 'user_profiles' table
            const { data, error } = await supabase
                .from('user_profiles') 
                .update({ 
                    is_premium_unlocked: true, 
                    mpesa_receipt: receiptCode 
                })
                .eq('phone', cleanPhone);
                
            if (error) throw error;
            
            // Log transaction transaction audit history inside the chat_payments log registry table
            await supabase
                .from('chat_payments')
                .insert([{ phone_number: cleanPhone, mpesa_receipt_number: receiptCode, amount: 250 }]);

            console.log(`Database transaction state execution complete. User profile ${cleanPhone} upgraded via receipt ${receiptCode}.`);
        }
    } catch (err) {
        console.error("Background Callback Processor Core Failure:", err.message);
    }
    
    // Safaricom gateway tracking demands an immediate HTTP 200 response to successfully terminate payment loop cycles
    res.status(200).json({ ResultCode: 0, ResultDesc: "Callback parsed and logged successfully." });
});

// Boot the application container engine
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server executing successfully on port line ${PORT}`));
