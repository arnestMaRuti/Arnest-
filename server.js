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
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qzvjqfhfdrneaozntlpi.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'postgresql://postgres:[YOUR-PASSWORD]@db.fezdfarrseinuumqzqqs.supabase.co:5432/postgres' 'sb_publishable_2a14UI2qXxQ10kIM4gRUKQ_bToLvrbp';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Pesapal parameters setup
const PESAPAL_CONSUMER_KEY = process.env.PESAPAL_CONSUMER_KEY;
const PESAPAL_CONSUMER_SECRET = process.env.PESAPAL_CONSUMER_SECRET;
const PESAPAL_URL = "https://cybersv.pesapal.com/api"; 

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
