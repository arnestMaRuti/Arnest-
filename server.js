const express = require('express');
const axios = require('axios');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 🗄️ Supabase Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qzvjqhfhdrneaozmtlpi.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 🧪 SAFARICOM SANDBOX TESTING CREDENTIALS
const M_PESA_SHORTCODE = '174379'; // Safaricom's Universal Test Shortcode
const M_PESA_PASSKEY = 'bfb27a7dd976563a62964d56b9f76653fa33a9922072cbd2378a5e11902414c0'; // Universal Test Passkey
const M_PESA_CONSUMER_KEY = 'YOUR_SANDBOX_CONSUMER_KEY'; // Get this from your Daraja Sandbox App
const M_PESA_CONSUMER_SECRET = 'YOUR_SANDBOX_CONSUMER_SECRET'; // Get this from your Daraja Sandbox App

// Route to serve your index.html frontend layout page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Helper Function: Requests OAuth Token from Sandbox Gateway
async function getMpesaToken() {
    const auth = Buffer.from(`${M_PESA_CONSUMER_KEY}:${M_PESA_CONSUMER_SECRET}`).toString('base64');
    try {
        // Changed URL to sandbox.safaricom.co.ke for testing
        const response = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
            headers: { Authorization: `Basic ${auth}` }
        });
        return response.data.access_token;
    } catch (err) {
        console.error("Safaricom Sandbox Auth Failure:", err.message);
        throw new Error("Failed to authenticate with Safaricom Sandbox.");
    }
}

// 💰 M-PESA STK PUSH TRIGGER ROUTE
app.post('/api/pay-unlock', async (req, res) => {
    let rawPhone = req.body.phone ? req.body.phone.trim() : '';
    if (!rawPhone) {
        return res.status(400).json({ success: false, error: "Phone number parameter is required." });
    }
    
    rawPhone = rawPhone.replace(/\+/g, '');
    if (rawPhone.startsWith('0')) {
        rawPhone = '254' + rawPhone.substring(1);
    } else if (!rawPhone.startsWith('254')) {
        rawPhone = '254' + rawPhone;
    }
    
    const amount = 1; // Testing with 1 KES instead of 250 KES for safety
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14); 
    const password = Buffer.from(`${M_PESA_SHORTCODE}${M_PESA_PASSKEY}${timestamp}`).toString('base64');

    try {
        const token = await getMpesaToken();
        
        const payload = {
            BusinessShortCode: M_PESA_SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            TransactionType: "CustomerPayBillOnline", // Sandbox test shortcode uses PayBill type
            Amount: amount,
            PartyA: rawPhone,
            PartyB: M_PESA_SHORTCODE, 
            PhoneNumber: rawPhone,
            CallBackURL: `https://${req.get('host')}/api/mpesa-callback`, 
            AccountReference: "TestSoulmate",
            TransactionDesc: "Sandbox Test Run"
        };

        // Changed URL to sandbox processing gateway
        const response = await axios.post('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', payload, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (response.data.ResponseCode === "0") {
            return res.status(200).json({ success: true, message: "Sandbox STK Prompt triggered!" });
        } else {
            return res.status(400).json({ success: false, error: "STK request rejected by Sandbox." });
        }

    } catch (err) {
        console.error("Sandbox STK Error:", err.response ? err.response.data : err.message);
        return res.status(500).json({ success: false, error: "Safaricom Sandbox gateway timeout." });
    }
});

// 📡 MPESA WEBHOOK CALLBACK LISTENER
app.post('/api/mpesa-callback', async (req, res) => {
    try {
        const callbackData = req.body.Body.stkCallback;
        if (callbackData.ResultCode === 0) {
            const metaItems = callbackData.CallbackMetadata.Item;
            const phoneItem = metaItems.find(item => item.Name === 'PhoneNumber');
            const receiptItem = metaItems.find(item => item.Name === 'MpesaReceiptNumber');
            
            const cleanPhone = '0' + phoneItem.Value.toString().substring(3); 
            const receiptCode = receiptItem.Value || 'SANDBOX_TEST';

            // Updates your Supabase user_profiles table seamlessly
            await supabase
                .from('user_profiles') 
                .update({ is_premium_unlocked: true, mpesa_receipt: receiptCode })
                .eq('phone', cleanPhone);
        }
    } catch (err) {
        console.error("Callback Database Writing Error:", err.message);
    }
    res.status(200).json({ ResultCode: 0, ResultDesc: "Callback parsed." });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Sandbox Testing Server running on port ${PORT}`));
