const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 🗄️ Supabase Environment variables initialization
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qzvjqhfhdrneaozmtlpi.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 📱 Safaricom Daraja API Production Credentials (Hardcoded from your screenshot)
const M_PESA_SHORTCODE = '9301663'; // Your Buy Goods Till Number / Store Number
const M_PESA_PASSKEY = process.env.M_PESA_PASSKEY || 'PASTE_YOUR_LIPA_NA_MPESA_ONLINE_PASSKEY'; 
const M_PESA_CONSUMER_KEY = process.env.M_PESA_CONSUMER_KEY || 'OtBDAcE3So3hwNr1xXIw9ux6apKRENUGQW02CDz8YU1C12yr';
const M_PESA_CONSUMER_SECRET = process.env.M_PESA_CONSUMER_SECRET || '17vNEaFA7JSqfzrPY2FMnGQGjg7rlz9QSRFJuK8KKPElbesIuSck9BXIvKa0OosO';

// Helper Function: Generates the mandatory Safaricom OAuth Access Token
async function getMpesaToken() {
    const auth = Buffer.from(`${M_PESA_CONSUMER_KEY}:${M_PESA_CONSUMER_SECRET}`).toString('base64');
    try {
        const response = await axios.get('https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
            headers: { Authorization: `Basic ${auth}` }
        });
        return response.data.access_token;
    } catch (err) {
        console.error("Token Generation Failure:", err.response ? err.response.data : err.message);
        throw new Error("Failed to authenticate with Safaricom API lines");
    }
}

// ROUTE: Direct M-Pesa STK Push Trigger
app.post('/api/pay-unlock', async (req, res) => {
    let rawPhone = req.body.phone ? req.body.phone.trim() : '';
    if (!rawPhone) {
        return res.status(400).json({ success: false, error: "Phone number parameter is required." });
    }
    
    // Standardize input format (Removes local 0 / + and replaces with Kenya country code 254)
    rawPhone = rawPhone.replace(/\+/g, '');
    if (rawPhone.startsWith('0')) {
        rawPhone = '254' + rawPhone.substring(1);
    } else if (!rawPhone.startsWith('254')) {
        rawPhone = '254' + rawPhone;
    }
    
    const amount = 250; // Subscription Cost
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14); // YYYYMMDDHHmmss
    
    // Password generation encrypted via Safaricom specifications
    const password = Buffer.from(`${M_PESA_SHORTCODE}${M_PESA_PASSKEY}${timestamp}`).toString('base64');

    try {
        const token = await getMpesaToken();
        
        const payload = {
            BusinessShortCode: "9301663", // Your Shortcode / Store Number
            Password: password,
            Timestamp: timestamp,
            TransactionType: "CustomerBuyGoodsOnline", // Explicitly sets layout to work with Buy Goods Tills
            Amount: amount,
            PartyA: rawPhone, // Customer mobile number paying
            PartyB: "9301663", // Till number store target
            PhoneNumber: rawPhone,
            CallBackURL: `https://${req.get('host')}/api/mpesa-callback`, // Your live dynamic webhook listener
            AccountReference: "Soulmate Premium",
            TransactionDesc: "Unlock Deep Conversations Match Profiles"
        };

        const response = await axios.post('https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest', payload, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (response.data.ResponseCode === "0") {
            return res.status(200).json({ success: true, message: "STK Prompt pushed out successfully!" });
        } else {
            return res.status(400).json({ success: false, error: "STK Push generation rejected by Safaricom." });
        }

    } catch (err) {
        console.error("STK Push Exception Error:", err.response ? err.response.data : err.message);
        return res.status(500).json({ success: false, error: "Safaricom network line connection timed out." });
    }
});

// ROUTE: Webhook CallBack URL Listener (Triggers when the client keys in their M-Pesa PIN)
app.post('/api/mpesa-callback', async (req, res) => {
    try {
        const callbackData = req.body.Body.stkCallback;
        console.log("Inbound Safaricom Callback Data:", JSON.stringify(callbackData));

        // ResultCode 0 explicitly means the user typed their PIN and transaction cleared!
        if (callbackData.ResultCode === 0) {
            const metaItems = callbackData.CallbackMetadata.Item;
            const phoneItem = metaItems.find(item => item.Name === 'PhoneNumber');
            const receiptItem = metaItems.find(item => item.Name === 'MpesaReceiptNumber');
            
            const cleanPhone = '0' + phoneItem.Value.toString().substring(3); // Standardizes 2547... to 07...
            const receiptCode = receiptItem.Value;

            // Update your user database schema profile row inside Supabase
            const { data, error } = await supabase
                .from('dating_users')
                .update({ 
                    is_premium_unlocked: true, 
                    mpesa_receipt: receiptCode 
                })
                .eq('phone', cleanPhone);
                
            if (error) throw error;
            console.log(`Success! Premium access unlocked for user profile line: ${cleanPhone}`);
        }
    } catch (err) {
        console.error("Callback database processing failure:", err.message);
    }
    
    // Safaricom gateway demands an instant HTTP 200 JSON closure receipt handshake
    res.status(200).json({ ResultCode: 0, ResultDesc: "Callback processed successfully" });
});

// Start application container
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server executing successfully on port ${PORT}`));
