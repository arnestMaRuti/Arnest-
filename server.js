const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const path = require('path');
const cookieSession = require('cookie-session');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cookieSession({
    name: 'soul_ai_session',
    keys: ['secure-encryption-pass-token-key-string'],
    maxAge: 24 * 60 * 60 * 1000
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qzvjqfhfdrneaozntlpi.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_2a14UI2qXxQ10kIM4gRUKQ_bToLvrbp';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PESAPAL_CONSUMER_KEY = process.env.PESAPAL_CONSUMER_KEY;
const PESAPAL_CONSUMER_SECRET = process.env.PESAPAL_CONSUMER_SECRET;
const PESAPAL_URL = "https://cybersv.pesapal.com/api"; 

// 1. SIGNUP ENDPOINT
app.post('/api/signup', async (req, res) => {
    const { name, phone, username } = req.body;
    try {
        const { data: existing } = await supabase.from('dating_users').select('id').eq('phone_number', phone).maybeSingle();
        if(existing) return res.status(400).json({ success: false, error: "Phone number already exists." });

        const { data: newUser, error } = await supabase.from('dating_users').insert([
            { username: username, phone_number: phone, email_address: `${username}@mail.com`, is_premium_unlocked: false }
        ]).select().single();

        if(error || !newUser) return res.status(400).json({ success: false, error: "Database rejected profile parameters." });

        req.session.user = newUser;
        return res.status(200).json({ success: true });
    } catch(err) { return res.status(500).json({ success: false, error: "Registry down." }); }
});

// 2. SIGNIN ENDPOINT
app.post('/api/signin', async (req, res) => {
    const { username } = req.body;
    try {
        const { data: user } = await supabase.from('dating_users').select('*').eq('username', username).maybeSingle();
        if(!user) return res.status(444).json({ success: false, error: "Username profile credentials not found." });

        req.session.user = user;
        return res.status(200).json({ success: true });
    } catch(err) { return res.status(500).json({ success: false, error: "Login failed." }); }
});

app.get('/', (req, res) => {
    if (req.session && req.session.user) res.redirect('/chat');
    else res.redirect('/login');
});

app.get('/login', (req, res) => { res.render('auth'); });
app.get('/logout', (req, res) => { req.session = null; res.redirect('/login'); });

// CHAT VIEW ROUTE
app.get('/chat', async (req, res) => {
    if (!req.session || !req.session.user) return res.redirect('/login');
    try {
        const { data: currentProfile } = await supabase.from('dating_users').select('*').eq('id', req.session.user.id).single();
        res.render('chat', { user: currentProfile || req.session.user });
    } catch(e) {
        res.render('chat', { user: req.session.user });
    }
});

// 3. SECURE AI ROUTE WITH PREMIUM VERIFICATION
app.post('/api/chat', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ locked: true });
    const { messageText } = req.body;

    try {
        const { data: profile } = await supabase.from('dating_users').select('is_premium_unlocked').eq('id', req.session.user.id).single();
        if (!profile || !profile.is_premium_unlocked) return res.status(200).json({ locked: true });

        if(!process.env.AI_API_KEY) return res.status(200).json({ locked: false, reply: "Clara: AI API configurations missing on deployment container dashboard." });

        const aiRes = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: "You are Clara, a loving romantic partner." }, { role: "user", content: messageText }]
        }, { headers: { 'Authorization': `Bearer ${process.env.AI_API_KEY}` } });

        return res.status(200).json({ locked: false, reply: aiRes.data.choices[0].message.content });
    } catch (err) { return res.status(200).json({ locked: true }); }
});

// 4. GENERATE PESAPAL LINK WITH INJECTED VALUES
app.post('/api/pay-unlock', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: "Session expired." });
    const { amount, phone } = req.body;

    try {
        const authRes = await axios.post(`${PESAPAL_URL}/Auth/RequestToken`, { consumer_key: PESAPAL_CONSUMER_KEY, consumer_secret: PESAPAL_CONSUMER_SECRET });
        const token = authRes.data.token;
        const merchantRef = `REG-${Date.now()}`;

        const paymentPayload = {
            id: merchantRef, amount: parseFloat(amount), description: "Unlock 15 Premium Match Chats",
            billing_address: { email_address: req.session.user.email_address || `${req.session.user.username}@mail.com`, phone_number: phone, first_name: req.session.user.username, last_name: "Member" },
            callback_url: `https://${req.get('host')}/api/pesapal-callback?userId=${req.session.user.id}`, notification_id: process.env.PESAPAL_IPN_ID
        };

        const orderRes = await axios.post(`${PESAPAL_URL}/Transactions/SubmitOrderRequest`, paymentPayload, { headers: { 'Authorization': `Bearer ${token}` } });
        return res.status(200).json({ redirectUrl: orderRes.data.redirect_url });
    } catch (err) { return res.status(500).json({ error: "Pesapal communication failure." }); }
});

app.get('/api/pesapal-callback', async (req, res) => {
    const { userId } = req.query;
    if(userId) await supabase.from('dating_users').update({ is_premium_unlocked: true }).eq('id', userId);
    res.redirect('/chat?status=success');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Active on ${PORT}`));
