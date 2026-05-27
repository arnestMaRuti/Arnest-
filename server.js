const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const path = require('path');
const cookieSession = require('cookie-session');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Establish secure encrypted cookie tracking configurations
app.use(cookieSession({
    name: 'soul_ai_session',
    keys: ['super-secret-encryption-passphrase-key'],
    maxAge: 24 * 60 * 60 * 1000 // 24 Hours
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const supabase = createClient(process.env.SUPABASE_URL ||
const SUPABASE_URL = process.env.SUPABASE_URL ||'https://qzvjqhfhdrneaozntlpi.supabase.co',
const SUPABASE_URL = process.env.SUPABASE_ANON_KEY || 'sb_publishable_2al4UI2qxXq10kIM4gRUkQ_bToLvrbp'');
const PESAPAL_CONSUMER_KEY = process.env.PESAPAL_CONSUMER_KEY;
const PESAPAL_CONSUMER_SECRET = process.env.PESAPAL_CONSUMER_SECRET;
const PESAPAL_URL = "https://cybersv.pesapal.com/api"; 

// API 1: Sign Up Account Action
app.post('/api/signup', async (req, res) => {
    const { name, phone, username, password } = req.body;
    try {
        // Look up table records to prevent registration duplication conflicts
        const { data: existing } = await supabase.from('dating_users').select('id').eq('phone_number', phone).maybeSingle();
        if(existing) return res.status(400).json({ success: false, error: "Phone number already exists." });

        const { data: newUser, error } = await supabase.from('dating_users').insert([
            { username: username, phone_number: phone, email_address: `${username}@soulai.com`, is_premium_unlocked: false }
        ]).select().single();

        if(error || !newUser) return res.status(400).json({ success: false, error: "Database rejected insert parameters." });

        req.session.user = newUser; // Establish login cookie state
        return res.status(200).json({ success: true });
    } catch(err) {
        return res.status(500).json({ success: false, error: "Internal registry down." });
    }
});

// API 2: Sign In Account Action
app.post('/api/signin', async (req, res) => {
    const { username } = req.body;
    try {
        const { data: user, error } = await supabase.from('dating_users').select('*').eq('username', username).maybeSingle();
        if(error || !user) return res.status(404).json({ success: false, error: "Username profile credentials not found." });

        req.session.user = user;
        return res.status(200).json({ success: true });
    } catch(err) {
        return res.status(500).json({ success: false, error: "Login pipeline crashed." });
    }
});

// ROUTE: Main Landing Page Router Control
app.get('/', (req, res) => {
    if (req.session && req.session.user) res.redirect('/chat');
    else res.redirect('/login');
});

app.get('/login', (req, res) => { res.render('auth'); });
app.get('/logout', (req, res) => { req.session = null; res.redirect('/login'); });

app.get('/chat', async (req, res) => {
    if (!req.session || !req.session.user) return res.redirect('/login');
    
    // Sync current live payment records from Supabase context
    const { data: currentProfile } = await supabase.from('dating_users').select('*').eq('id', req.session.user.id).single();
    res.render('chat', { user: currentProfile || req.session.user });
});

// API 3: Messaging Interface Handler Engine
app.post('/api/chat', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ locked: true });
    const { messageText } = req.body;

    try {
        const { data: profile } = await supabase.from('dating_users').select('is_premium_unlocked').eq('id', req.session.user.id).single();
        if (!profile || !profile.is_premium_unlocked) {
            return res.status(200).json({ locked: true }); // Triggers the Ksh 250 payment request popup block
        }

        if(!process.env.AI_API_KEY) return res.status(200).json({ locked: false, reply: "Clara: Your message text received completely, but my AI environment keys require updates on Render." });

        const aiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: "You are Clara, an affectionate romantic woman." }, { role: "user", content: messageText }]
        }, { headers: { 'Authorization': `Bearer ${process.env.AI_API_KEY}` } });

        return res.status(200).json({ locked: false, reply: aiResponse.data.choices[0].message.content });
    } catch (err) {
        return res.status(200).json({ locked: true }); 
    }
});

// API 4: Generate Pesapal Order Request Link Hook
app.post('/api/pay-unlock', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: "Session expired." });
    const { amount, phone } = req.body;

    try {
        const authRes = await axios.post(`${PESAPAL_URL}/Auth/RequestToken`, { consumer_key: PESAPAL_CONSUMER_KEY, consumer_secret: PESAPAL_CONSUMER_SECRET });
        const token = authRes.data.token;
        const merchantRef = `REG-${Date.now()}`;

        const paymentPayload = {
            id: merchantRef, amount: parseFloat(amount), description: "Unlock 15 Premium Matches",
            billing_address: { email_address: req.session.user.email_address, phone_number: phone, first_name: req.session.user.username, last_name: "Member" },
            callback_url: `https://${req.get('host')}/api/pesapal-callback?userId=${req.session.user.id}`, notification_id: process.env.PESAPAL_IPN_ID
        };

        const orderRes = await axios.post(`${PESAPAL_URL}/Transactions/SubmitOrderRequest`, paymentPayload, { headers: { 'Authorization': `Bearer ${token}` } });
        return res.status(200).json({ redirectUrl: orderRes.data.redirect_url });
    } catch (err) { 
        return res.status(500).json({ error: "Pesapal routing failed" }); 
    }
});

// API 5: Pesapal Complete Payment Return Pipeline Redirect Handling
app.get('/api/pesapal-callback', async (req, res) => {
    const { userId } = req.query;
    try {
        if(userId) {
            await supabase.from('dating_users').update({ is_premium_unlocked: true }).eq('id', userId);
        }
        res.redirect('/chat?status=success');
    } catch (err) {
        res.redirect('/chat?status=error');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Active on ${PORT}`));
