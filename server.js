const express = require('express');
const axios = require('axios');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ⚙️ Express settings for reading forms and JSON data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 🎨 Tell Express how to serve your EJS frontend templates
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

// 🗄️ Supabase Initialization
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qzvjqhfhdrneaozmtlpi.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 📱 Safaricom M-Pesa Credentials
const M_PESA_SHORTCODE = '9301663'; 
const M_PESA_PASSKEY = process.env.M_PESA_PASSKEY || 'PASTE_YOUR_LIPA_NA_MPESA_ONLINE_PASSKEY'; 
const M_PESA_CONSUMER_KEY = process.env.M_PESA_CONSUMER_KEY || 'OtBDAcE3So3hwNr1xXIw9ux6apKRENUGQW02CDz8YU1C12yr';
const M_PESA_CONSUMER_SECRET = process.env.M_PESA_CONSUMER_SECRET || '17vNEaFA7JSqfzrPY2FMnGQGjg7rlz9QSRFJuK8KKPElbesIuSck9BXIvKa0OosO';

// ==========================================
// 1. SERVE THE MAIN FRONTEND PAGE ROUTE
// ==========================================
app.get('/', (req, res) => {
    // This looks for 'index.ejs' inside your 'views' folder and displays it!
    res.render('index'); 
});

// Helper Function: Generates Safaricom OAuth Access Token
async function getMpesaToken() {
    const auth = Buffer.from(`${M_PESA_CONSUMER_KEY}:${M_PESA_CONSUMER_SECRET}`).toString('base64');
    try {
        const response = await axios.get('https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
            headers: { Authorization: `Basic ${auth}` }
        });
        return response.data.access_token;
    } catch (err) {
        console.error("Token Generation Failure:", err.message);
        throw new Error("Failed to authenticate with Safaricom");
    }
}

// ==========================================
// 2. M-PESA STK PUSH TRIGGER ROUTE
// ==========================================
app.post('/api/pay-unlock', async (req, res) => {
    let rawPhone = req.body.phone ? req.body.phone.trim() : '';
    if (!rawPhone) {
        return res.status(400).json({ success: false, error: "Phone number is required." });
    }
    
    rawPhone = rawPhone.replace(/\+/g, '');
    if (rawPhone.startsWith('0')) {
        rawPhone = '254' + rawPhone.substring(1);
    } else if (!rawPhone.startsWith('254')) {
        rawPhone = '254' + rawPhone;
    }
    
    const amount = 250; 
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14); 
    const password = Buffer.from(`${M_PESA_SHORTCODE}${M_PESA_PASSKEY}${timestamp}`).toString('base64');

    try {
        const token = await getMpesaToken();
        
        const payload = {
            BusinessShortCode: M_PESA_SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            TransactionType: "CustomerBuyGoodsOnline", 
            Amount: amount,
            PartyA: rawPhone, 
            PartyB: M_PESA_SHORTCODE, 
            PhoneNumber: rawPhone,
            CallBackURL: `https://${req.get('host')}/api/mpesa-callback`, 
            AccountReference: "Soulmate Premium",
            TransactionDesc: "Unlock Deep Conversations"
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
        return res.status(500).json({ success: false, error: "Safaricom network connection timeout." });
    }
});

// ==========================================
// 3. MPESA CALLBACK WEBHOOK ROUTER
// ==========================================
app.post('/api/mpesa-callback', async (req, res) => {
    try {
        const callbackData = req.body.Body.stkCallback;
        if (callbackData.ResultCode === 0) {
            const metaItems = callbackData.CallbackMetadata.Item;
            const phoneItem = metaItems.find(item => item.Name === 'PhoneNumber');
            const receiptItem = metaItems.find(item => item.Name === 'MpesaReceiptNumber');
            
            const cleanPhone = '0' + phoneItem.Value.toString().substring(3); 
            const receiptCode = receiptItem.Value;

            await supabase
                .from('dating_users')
                .update({ is_premium_unlocked: true, mpesa_receipt: receiptCode })
                .eq('phone', cleanPhone);
                
            console.log(`Success! Premium access unlocked for user: ${cleanPhone}`);
        }
    } catch (err) {
        console.error("Callback database writing error:", err.message);
    }
    res.status(200).json({ ResultCode: 0, ResultDesc: "Callback processed successfully" });
});

// Start Application Container
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running successfully on port ${PORT}`));
