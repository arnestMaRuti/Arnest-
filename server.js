const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const path = require('path');
const cookieSession = require('cookie-session');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session storage configuration to remember logged-in accounts
app.use(cookieSession({
    name: 'soul_ai_session',
    keys: ['secure-encryption-pass-token-key-string'],
    maxAge: 24 * 60 * 60 * 1000 // 24 Hours
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Supabase Environment variables initialization
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qzvjqhfhdrneaozntlpi.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_2al4UI2qxXq10kIM4gRUkQ_bToLvrbp';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
// Safaricom Daraja API Production Credentials
const M_PESA_SHORTCODE = '9301663'; // e.g. Buy Goods Till Number
const M_PESA_PASSKEY = 'PASTE_YOUR_LIPA_NA_MPESA_ONLINE_PASSKEY'; // Found in Daraja Portal
const M_PESA_CONSUMER_KEY = '0tBDAtE3So3hwNr1xXIw9ux6apKRENUGQW02C9z8YUiC12yr';
const M_PESA_CONSUMER_SECRET = 'l7WNEaFA7J5qfzrPY2FMnGQGjg7rLz9QSRFJwK88kPElbesLuScW98XIvKaOOos0';

// Helper Function: Generates the mandatory Safaricom Access Token
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

// ROUTE 4: Direct M-Pesa STK Push Trigger
app.post('/api/pay-unlock', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: "Session expired." });
    
    // Standardize input format (Removes local 0 and replaces with Kenya country code 254)
    let rawPhone = req.body.phone.trim();
    if (rawPhone.startsWith('0')) {
        rawPhone = '254' + rawPhone.substring(1);
    }
    
    const amount = 250; // Subscription Cost
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14); // YYYYMMDDHHmmss
    
    // Password encryption rule dictated by Safaricom API standards
    const password = Buffer.from(`${M_PESA_SHORTCODE}${M_PESA_PASSKEY}${timestamp}`).toString('base64');

    try {
        const token = await getMpesaToken();
        
        const payload = {
            BusinessShortCode: M_PESA_SHORTCODE, // Use your store number if using Buy Goods
            Password: password,
            Timestamp: timestamp,
            TransactionType: "CustomerBuyGoodsOnline", // Change to "CustomerPayBillOnline" if using Paybill
            Amount: amount,
            PartyA: rawPhone, // Handset sending the money
            PartyB: M_PESA_SHORTCODE, // Till number receiving the money
            PhoneNumber: rawPhone,
            CallBackURL: `https://${req.get('host')}/api/mpesa-callback`, // Your live listener route
            AccountReference: "SoulAI Premium",
            TransactionDesc: "Unlock Premium Match Chat Profiles"
        };

        const response = await axios.post('https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest', payload, {
            headers: { Authorization: `Bearer ${token}` }
        });

        // Response Code "0" means Safaricom accepted the request and pushed it to the device!
        if (response.data.ResponseCode === "0") {
            return res.status(200).json({ success: true, message: "STK Prompt pushed out successfully!" });
        } else {
            return res.status(400).json({ success: false, error: "STK Push generation rejected by gateway." });
        }

    } catch (err) {
        console.error("STK Push Exception Error:", err.response ? err.response.data : err.message);
        return res.status(500).json({ success: false, error: "Safaricom network line connection timed out." });
    }
});

// ROUTE 5: Webhook CallBack URL Listener (Triggers when the user puts their PIN)
app.post('/api/mpesa-callback', async (req, res) => {
    const callbackData = req.body.Body.stkCallback;
    console.log("Inbound Safaricom Callback Data:", JSON.stringify(callbackData));

    // ResultCode 0 means transaction went through successfully!
    if (callbackData.ResultCode === 0) {
        // Pull the telephone number out of the payment data block metadata
        const metaItems = callbackData.CallbackMetadata.Item;
        const phoneItem = metaItems.find(item => item.Name === 'PhoneNumber');
        const cleanPhone = '0' + phoneItem.Value.toString().substring(3); // Normalizes '2547...' back to '07...'

        try {
            // Instantly updates your user profile row inside Supabase
            await supabase
                .from('dating_users')
                .update({ is_premium_unlocked: true })
                .eq('phone', cleanPhone);
                
            console.log(`Success! Premium access unlocked for user profile line: ${cleanPhone}`);
        } catch (dbErr) {
            console.error("Database status write crash:", dbErr);
        }
    }
    
    // Safaricom expects a standard JSON receipt closure block
    res.status(200).json({ ResultCode: 0, ResultDesc: "Callback data logged successfully" });
});

// ROUTE 1: Primary Gateway Router Control
app.get('/', (req, res) => {
    res.render('chat', { user: (req.session && req.session.user) ? req.session.user : null });
});

// ROUTE 2: Authentication Handlers (Syntax-Safe Separation)
app.post('/api/auth', async (req, res) => {
    const { username, phone, isSignUp } = req.body;
    
    if (!username || !phone) {
        return res.status(400).json({ success: false, error: "Username and Phone number are required." });
    }

    try {
        if (isSignUp) {
            // 1. Check for existing username (Independent query to avoid syntax issues)
            const { data: userExists } = await supabase
                .from('dating_users')
                .select('username')
                .eq('username', username)
                .maybeSingle();

            if (userExists) {
                return res.status(400).json({ success: false, error: "Username is already taken." });
            }

            // 2. Check for existing phone
            const { data: phoneExists } = await supabase
                .from('dating_users')
                .select('phone')
                .eq('phone', phone)
                .maybeSingle();

            if (phoneExists) {
                return res.status(400).json({ success: false, error: "Phone number is already registered." });
            }

            // 3. Clean insert matching your active database table columns
            const { data: newUser, error: insertError } = await supabase
                .from('dating_users')
                .insert([{ username: username, phone: phone }])
                .select()
                .maybeSingle();

            if (insertError) {
                console.error("Supabase Insertion Error:", insertError);
                return res.status(400).json({ 
                    success: false, 
                    error: `Database rejected entry. Reason: ${insertError.message || 'Check column names'}` 
                });
            }

            req.session.user = newUser;
            return res.status(200).json({ success: true, user: newUser });

        } else {
            // Sign In Logic matching user username parameters
            const { data: user, error: loginErr } = await supabase
                .from('dating_users')
                .select('*')
                .eq('username', username)
                .maybeSingle();

            if (loginErr || !user) {
                return res.status(444).json({ success: false, error: "Profile username records not found." });
            }

            req.session.user = user;
            return res.status(200).json({ success: true, user: user });
        }

    } catch (err) {
        console.error("Auth Exception:", err);
        return res.status(500).json({ success: false, error: "Internal server authentication error." });
    }
});

app.get('/logout', (req, res) => { req.session = null; res.redirect('/'); });

// ROUTE 3: Secure AI Chat Endpoint with Premium Access Check Filter
app.post('/api/chat', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ locked: true, error: "Please log in first." });
    const { messageText, partnerName } = req.body;

    try {
        const { data: profile } = await supabase.from('dating_users').select('is_premium_unlocked').eq('id', req.session.user.id).single();
        if (!profile || !profile.is_premium_unlocked) {
            return res.status(200).json({ locked: true, msg: "Access locked. Subscription required." });
        }

        if(!process.env.AI_API_KEY) return res.status(200).json({ locked: false, reply: `${partnerName}: OpenAI API key is missing from environment variables.` });

        const aiRes = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: `You are ${partnerName}, a premium dating partner model. Attentive, immersive and warm.` },
                { role: "user", content: messageText }
            ]
        }, { headers: { 'Authorization': `Bearer ${process.env.AI_API_KEY}` } });

        return res.status(200).json({ locked: false, reply: aiRes.data.choices[0].message.content });
    } catch (err) { return res.status(200).json({ locked: true }); }
});

// ROUTE 4: Pesapal Payment Token Generator and Checkout Order Submitter
app.post('/api/pay-unlock', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: "Session expired." });
    const { amount, phone } = req.body;

    try {
        const authRes = await axios.post(`${PESAPAL_URL}/Auth/RequestToken`, { consumer_key: PESAPAL_CONSUMER_KEY, consumer_secret: PESAPAL_CONSUMER_SECRET });
        const token = authRes.data.token;
        const merchantRef = `REG-${Date.now()}`;

        const paymentPayload = {
            id: merchantRef, amount: parseFloat(amount), description: "Unlock 15 Premium Match Profiles",
            billing_address: { email_address: `${req.session.user.username}@mail.com`, phone_number: phone, first_name: req.session.user.username, last_name: "Member" },
            callback_url: `https://${req.get('host')}/api/pesapal-callback?userId=${req.session.user.id}`, notification_id: process.env.PESAPAL_IPN_ID
        };

        const orderRes = await axios.post(`${PESAPAL_URL}/Transactions/SubmitOrderRequest`, paymentPayload, { headers: { 'Authorization': `Bearer ${token}` } });
        return res.status(200).json({ redirectUrl: orderRes.data.redirect_url });
    } catch (err) { return res.status(500).json({ error: "Pesapal connection failed." }); }
});

app.get('/api/pesapal-callback', async (req, res) => {
    const { userId } = req.query;
    if(userId) await supabase.from('dating_users').update({ is_premium_unlocked: true }).eq('id', userId);
    res.redirect('/?status=success');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server executing successfully on port ${PORT}`));
