const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_ANON_KEY || 'sb_publishable_2al4UI2qxXq10kIM4gRUkQ_bToLvrbp');

const PESAPAL_CONSUMER_KEY = process.env.PESAPAL_CONSUMER_KEY;
const PESAPAL_CONSUMER_SECRET = process.env.PESAPAL_CONSUMER_SECRET;
const PESAPAL_URL = "https://cybersv.pesapal.com/api"; 

const AI_PERSONALITY_PROMPT = "You are Clara, a deeply warm and empathetic woman seeking romantic alignment. Keep replies short, affectionate and real.";

app.get('/chat', (req, res) => { res.render('chat'); });

// AI Route: Responds immediately or serves a safe catch paywall check parameter fallback
app.post('/api/chat', async (req, res) => {
    const { messageText } = req.body;
    try {
        // If your OpenAI variable isn't assigned yet, fail gracefully to display the payment screen instantly
        if(!process.env.AI_API_KEY) {
            return res.status(200).json({ locked: true });
        }

        const aiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: AI_PERSONALITY_PROMPT }, { role: "user", content: messageText }]
        }, { headers: { 'Authorization': `Bearer ${process.env.AI_API_KEY}` } });

        const aiReply = aiResponse.data.choices[0].message.content;
        return res.status(200).json({ locked: false, reply: aiReply });
    } catch (err) {
        // Fallback safety layer: prompts payment screen if any third-party API breaks
        return res.status(200).json({ locked: true }); 
    }
});

// Pesapal Pipeline Gateway
app.post('/api/pay-unlock', async (req, res) => {
    const { amount, phone, email } = req.body;
    try {
        const authRes = await axios.post(`${PESAPAL_URL}/Auth/RequestToken`, { 
            consumer_key: PESAPAL_CONSUMER_KEY, 
            consumer_secret: PESAPAL_CONSUMER_SECRET 
        });
        const token = authRes.data.token;
        const merchantRef = `REG-${Date.now()}`;

        const paymentPayload = {
            id: merchantRef, amount: parseFloat(amount), description: "Premium Unlock Plan Selection",
            billing_address: { email_address: email || "user@mail.com", phone_number: phone, first_name: "Customer", last_name: "Member" },
            callback_url: `https://${req.get('host')}/api/pesapal-callback`, notification_id: process.env.PESAPAL_IPN_ID
        };

        const orderRes = await axios.post(`${PESAPAL_URL}/Transactions/SubmitOrderRequest`, paymentPayload, { headers: { 'Authorization': `Bearer ${token}` } });
        return res.status(200).json({ redirectUrl: orderRes.data.redirect_url });
    } catch (err) { 
        return res.status(500).json({ error: "Payment routing setup failed" }); 
    }
});

app.get('/api/pesapal-callback', (req, res) => { res.redirect('/chat?status=success'); });
app.get('/', (req, res) => { res.redirect('/chat'); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Active on ${PORT}`));
