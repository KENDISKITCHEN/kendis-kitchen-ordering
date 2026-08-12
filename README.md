# Kendis Kitchen Online Ordering App

This app is designed for Kendis Kitchen and uses the Wave API instead of Stripe.

## What it does
- Shows the Kendis Kitchen menu and prices.
- Lets customers select quantities.
- Collects customer name, email, phone, pickup date/time, and notes.
- Creates/uses a customer in Wave.
- Creates menu products in Wave when needed.
- Creates a Wave invoice for the order.
- Disables bank payments on the invoice and leaves card payments enabled.
- Sends the customer to Wave's hosted invoice/payment page.
- Gives the customer a Google Calendar "Add to Google Calendar" link for the pickup appointment.

## Important debit-card limitation
Wave's public API exposes a `disableCreditCardPayments` setting, but it does not expose a separate "debit card only" setting. Therefore the app cannot technically distinguish or enforce debit vs. credit cards. The page clearly requests debit-card payment, while the Wave invoice handles the actual card payment.

## Deploy on Render
1. Put these files in a GitHub repository.
2. In Render choose **New > Web Service**.
3. Choose **GitHub** and select the repository.
4. Build Command: `npm install`
5. Start Command: `npm start`
6. Add environment variables:
   - `WAVE_ACCESS_TOKEN` = your Wave application access token
   - `WAVE_BUSINESS_ID` = the Kendis Kitchen Wave business ID
7. Deploy.

Do NOT put the Wave access token in GitHub or in the browser code.

## Wave setup
Your Wave Developer application needs access to the relevant resources. For this app, the token must be able to read/write customers, products, and invoices. Wave's current API is GraphQL and uses the endpoint documented in its developer portal.

## Google Calendar
The app uses a Google Calendar event-creation URL, so customers can add the pickup to their own calendar without giving the website access to their Google account. This is simpler and safer than storing a Google OAuth credential.

## Note about pickup times
The calendar event is created as a zero-duration event at the selected pickup time. You can later change the app to use a fixed pickup duration (for example, 30 minutes or 1 hour).
