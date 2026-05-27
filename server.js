const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const path = require('path');
const cookieSession = require('cookie-session');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session storage setup to remember logged in users
app.use(cookieSession({
    name: 'soul_ai_session',
    keys: ['secure-encryption-pass-token-key-string'],
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Connects directly to your existing Supabase database configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qzvjqfhfdrneaozntlpi.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_2a14UI2qXxQ10kIM4gRUKQ_bToLvrbp';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Pesapal setup endpoints
const PESAPAL_CONSUMER_KEY = process.env.PESAPAL_CONSUMER_KEY;
const PESAPAL_CONSUMER_SECRET = process.env.PESAPAL_CONSUMER_SECRET;
const PESAPAL_URL = "https://cybersv.pesapal.com/api"; 

// ROUTE 1: Main Gateway Redirection
app.get('/', (req, res) => {
    res.render('chat', { user: (req.session && req.session.user) ? req.session.user : null });
});

// ROUTE 2: Authentication Handlers (Interacts with your existing user records)
app.post('/api/auth', async (req, res) => {
    const { username, phone, isSignUp } = req.body;
    
    if (!username) {
        return res.status(400).json({ success: false, error: "Username is required." });
    }

    try {
        if (isSignUp) {
            // 1. Check if username or phone exists (Handles both potential column structures safely)
            let existingUser = null;
            
            const { data: check1 } = await supabase.from('dating_users').select('*').eq('username', username).maybeSingle();
            if (check1) existingUser = check1;

            if (!existingUser) {
                const { data: check2 } = await supabase.from('dating_users').select('*').eq('phone_number', phone).maybeSingle();
                if (check2) existingUser = check2;
            }

            if (!existingUser) {
                const { data: check3 } = await supabase.from('dating_users').select('*').eq('phone', phone).maybeSingle();
                if (check3) existingUser = check3;
            }

            if (existingUser) {
                return res.status(400).json({ success: false, error: "Username or phone number already exists." });
            }

            // 2. Run sequential registration insertion fallbacks
            // STRATEGY A: Try standard 'phone_number' and 'email_address' layout
            const { data: userA, error: errA } = await supabase
                .from('dating_users')
                .insert([{ username: username, phone_number: phone, email_address: `${username}@mail.com`, is_premium_unlocked: false }])
                .select()
                .maybeSingle();

            if (!errA && userA) {
                req.session.user = userA;
                return res.status(200).json({ success: true, user: userA });
            }

            // STRATEGY B: Try simple 'phone' and 'email' layout fallback
            const { data: userB, error: errB } = await supabase
                .from('dating_users')
                .insert([{ username: username, phone: phone, email: `${username}@mail.com`, is_premium_unlocked: false }])
                .select()
                .maybeSingle();

            if (!errB && userB) {
                req.session.user = userB;
                return res.status(200).json({ success: true, user: userB });
            }

            // STRATEGY C: Minimalist approach (Just Username and Phone)
            const { data: userC, error: errC } = await supabase
                .from('dating_users')
                .insert([{ username: username, phone_number: phone }])
                .select()
                .maybeSingle();

            if (!errC && userC) {
                req.session.user = userC;
                return res.status(200).json({ success: true, user: userC });
            }

            // If everything fails, throw the explicit structural rejection trace
            return res.status(400).json({ 
                success: false, 
                error: "Database column mismatch. Please verify that your table has columns named 'username' and either 'phone_number' or 'phone'." 
            });

        } else {
            // LOGIN FLOW: Find the profile by username entry match
            const { data: user, error: loginErr } = await supabase
                .from('dating_users')
                .select('*')
                .eq('username', username)
                .maybeSingle();

            if (loginErr || !user) {
                return res.status(444).json({ success: false, error: "Profile username records not found." });
            }

            req.session.user = user;
            return res.status(200).json({ success: true, user: req.session.user });
        }

    } catch (err) {
        console.error("System Authentication Catch Block Error:", err);
        return res.status(500).json({ success: false, error: "Internal server error during authentication process." });
    }
});
// ROUTE 3: Secure AI Chat Endpoint with Compulsory Paid Check Filter
app.post('/api/chat', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ locked: true, error: "Please log in first." });
    const { messageText, partnerName } = req.body;

    try {
        // Enforces payment access validation check against your database row state
        const { data: profile } = await supabase.from('dating_users').select('is_premium_unlocked').eq('id', req.session.user.id).single();
        if (!profile || !profile.is_premium_unlocked) {
            return res.status(200).json({ locked: true, msg: "Access locked. Subscription required." });
        }

        if(!process.env.AI_API_KEY) return res.status(200).json({ locked: false, reply: `${partnerName}: Open AI API key is missing from your environment variables.` });

        const aiRes = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: `You are ${partnerName}, a beautiful, loving, and deeply attentive romantic partner on a dating application. Keep replies highly immersive and natural.` },
                { role: "user", content: messageText }
            ]
        }, { headers: { 'Authorization': `Bearer ${process.env.AI_API_KEY}` } });

        return res.status(200).json({ locked: false, reply: aiRes.data.choices[0].message.content });
    } catch (err) { return res.status(200).json({ locked: true }); }
});

// ROUTE 4: Pesapal Payment STK Push Handler Link Hook
app.post('/api/pay-unlock', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: "Session expired." });
    const { amount, phone } = req.body;

    try {
        const authRes = await axios.post(`${PESAPAL_URL}/Auth/RequestToken`, { consumer_key: PESAPAL_CONSUMER_KEY, consumer_secret: PESAPAL_CONSUMER_SECRET });
        const token = authRes.data.token;
        const merchantRef = `REG-${Date.now()}`;

        const paymentPayload = {
            id: merchantRef, amount: parseFloat(amount), description: "Unlock 15 Premium Match Profiles",
            billing_address: { email_address: req.session.user.email_address || `${req.session.user.username}@mail.com`, phone_number: phone, first_name: req.session.user.username, last_name: "Member" },
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
