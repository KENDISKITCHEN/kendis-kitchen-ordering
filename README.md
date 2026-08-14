# Kendis Kitchen Online Ordering App

This app is designed for Kendis Kitchen and uses the Wave API for customers, products, invoices, payments, payment receipts, and the order-management dashboard.

## What it does
- Shows the Kendis Kitchen menu with categories.
- Lets customers select quantities.
- Collects customer name, email, phone, pickup date/time, and notes.
- Creates/uses a customer in Wave.
- Creates menu products in Wave when needed.
- Creates a Wave invoice for the order.
- Leaves Wave bank and card payment options enabled according to the invoice settings.
- Sends the customer to Wave's hosted invoice/payment page.
- Detects payment status from Wave.
- Sends a Wave payment receipt to the customer's email after the invoice is paid, with the receipt PDF attached when supported by the Wave business email settings.
- Gives the customer a Google Calendar "Add to Google Calendar" link for the pickup appointment.
- Provides a password-protected `/admin` order-management dashboard.
- Lets the kitchen move paid orders through NEW, CONFIRMED, PREPARING, READY, COMPLETED, and CANCELLED.
- Stores the kitchen status in the Wave invoice memo so the status remains available after a Render restart.

## Menu categories
The online menu is organized into:
- Rice & Sides
- Meat & Chicken
- Soups & Stews
- Swallows
- Small Chops & Snacks

## Important debit-card limitation
Wave's public API exposes a `disableCreditCardPayments` setting, but it does not expose a separate "debit card only" setting. Therefore the app cannot technically distinguish or enforce debit vs. credit cards. The Wave invoice handles the actual card payment.

## Deploy on Render
1. Put these files in a GitHub repository.
2. In Render choose **New > Web Service**.
3. Choose **GitHub** and select the repository.
4. Build Command: `npm install`
5. Start Command: `npm start`
6. Add environment variables:
   - `WAVE_ACCESS_TOKEN` = your Wave application access token
   - `WAVE_BUSINESS_ID` = the Kendis Kitchen Wave business ID
   - `WAVE_WEBHOOK_SECRET` = the signing secret for the Wave webhook
   - `WAVE_INCOME_ACCOUNT_ID` = optional; use this if you want to explicitly control the Wave income account used for menu products
   - `ADMIN_PASSWORD` = a strong password used for `/admin`
7. Deploy.

Do NOT put the Wave access token, webhook secret, or admin password in GitHub or in browser code.

## Admin dashboard
After deployment, open:
`https://YOUR-RENDER-URL.onrender.com/admin`

The dashboard requires `ADMIN_PASSWORD` to be configured in Render. It reads order/customer/payment information from Wave and uses Wave's `invoicePatch` mutation to persist the kitchen status in the invoice memo.

## Wave setup
The Wave Developer application needs access to the relevant resources. For this app, the token must be able to read/write customers, products, and invoices. The app also uses Wave's `invoice.paid` webhook event so it can trigger a payment receipt when an invoice is paid. The Wave business must have its email-sending capability enabled for Wave email features to work.

Webhook endpoint:
`https://YOUR-RENDER-URL.onrender.com/api/wave-webhook`

In Wave Webhooks, enable at least:
- `invoice.paid`
- `invoice.partially_paid` (optional if you later want partial-payment emails)

## Google Calendar
The app uses a Google Calendar event-creation URL, so customers can add the pickup to their own calendar without giving the website access to their Google account. This is simpler and safer than storing a Google OAuth credential.

## Note about pickup times
The calendar event is created as a zero-duration event at the selected pickup time. You can later change the app to use a fixed pickup duration (for example, 30 minutes or 1 hour).
