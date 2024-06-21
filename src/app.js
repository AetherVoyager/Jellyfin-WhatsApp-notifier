require('dotenv').config();
const express = require('express');
const wppconnect = require('@wppconnect-team/wppconnect');
const bodyParser = require('body-parser');


const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

let client;

const initializeWhatsApp = async () => {
  try {
    client = await wppconnect.create({
      session: 'jellyfin-notifier',
      autoClose: false,
      puppeteerOptions: { 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--headless', '--disable-gpu'],
        headless: 'new'
      }
    });

    console.log('Client is ready!');

    client.onStateChange((state) => {
      console.log('State changed:', state);
      if (state === 'CONNECTED') {
        console.log('Client is authenticated and ready to send messages.');
        listGroups();
      }
    });

    client.onDisconnected((reason) => {
      console.log('Client was disconnected', reason);
      initializeWhatsApp().catch(console.error);
    });

  } catch (error) {
    console.error('Error initializing client:', error);
  }
};

const listGroups = async () => {
  try {
    const chats = await client.getAllChats();
    const groups = chats.filter(chat => chat.isGroup);
    console.log('Available groups:');
    groups.forEach(group => {
      console.log(`Name: ${group.name}, ID: ${group.id._serialized}`);
    });
  } catch (error) {
    console.error('Error listing groups:', error);
  }
};

initializeWhatsApp().catch(console.error);

setInterval(() => {
  if (client && client.isConnected()) {
    console.log('WhatsApp client is still connected');
  } else {
    console.log('WhatsApp client is not connected');
    initializeWhatsApp().catch(console.error);
  }
}, 60000); // Check every minute

app.get('/groups', async (req, res) => {
  try {
    if (!client || !client.isConnected()) {
      throw new Error('WhatsApp client not initialized or not connected');
    }
    const chats = await client.getAllChats();
    const groups = chats.filter(chat => chat.isGroup).map(group => ({
      name: group.name,
      id: group.id._serialized
    }));
    res.json(groups);
  } catch (error) {
    console.error('Error fetching groups:', error);
    res.status(500).json({ error: 'Failed to fetch groups', details: error.message });
  }
});

app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));
app.use(bodyParser.text({ type: 'text/plain' }));

app.post('/webhook', async (req, res) => {
  console.log('Received webhook request');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  
  let data;
  if (req.is('text/plain')) {
    try {
      data = JSON.parse(req.body);
    } catch (error) {
      console.error('Error parsing text/plain body:', error);
      return res.status(400).json({ error: 'Invalid JSON in text/plain body' });
    }
  } else {
    data = req.body;
  }
  
  console.log('Parsed Body:', JSON.stringify(data, null, 2));

  if (!data || Object.keys(data).length === 0) {
    console.log('Received empty payload');
    return res.status(400).json({ error: 'Empty payload received' });
  }

  if (!data.NotificationType) {
    console.log('Invalid payload: NotificationType is missing');
    return res.status(400).json({ error: 'Invalid payload: NotificationType is required' });
  }

  let message;

  switch (data.NotificationType) {
    case 'ItemAdded':
      message = `New ${data.ItemType} Added\nName: ${data.Name}\nRuntime: ${data.RunTime}\nPremiere Date: ${data.PremiereDate}`;
      break;
    case 'PlaybackStart':
      message = `${data.NotificationUsername} started watching\n${data.Name}`;
      break;
    case 'PlaybackStop':
      message = `${data.NotificationUsername} stopped watching\n${data.Name}`;
      break;
    case 'AuthenticationSuccess':
      message = `Successful Login\n${data.NotificationUsername} Logged in`;
      break;
    case 'AuthenticationFailure':
      message = `Failed Login Attempt\n${data.Username} login attempt failed`;
      break;
    default:
      console.log(`Unsupported notification type: ${data.NotificationType}`);
      return res.status(400).json({ error: 'Unsupported notification type' });
  }

  try {
    if (!client || !client.isConnected()) {
      throw new Error('WhatsApp client not initialized or not connected');
    }

    const chatId = process.env.WHATSAPP_GROUP_ID;
    console.log('Attempting to send message to:', chatId);
    console.log('Message content:', message);

    const sentMessage = await client.sendText(chatId, message);
    console.log('Message sent successfully:', sentMessage);
    res.status(200).json({ success: true, message: 'Notification sent' });
  } catch (error) {
    console.error('Detailed error:', error);
    res.status(500).json({ error: 'Failed to send notification', details: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
