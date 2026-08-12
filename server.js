import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 10000;
const WAVE_ENDPOINT = "https://gql.waveapps.com/graphql/public";

const MENU = [
  ["Jollof Rice Full Tray",80],["Jollof Rice Half Tray",50],
  ["Fried Rice Full Tray",120],["Fried Rice Half Tray",60],
  ["Bitter Leaf Half Tray",180],["Assorted Beef Full Tray",350],
  ["Full Beef Tray",400],["Ayamase (Designer) Stew Full Tray",360],
  ["Ayamase (Designer) Stew Half Tray",180],["Fried Plantain Full Tray",120],
  ["Fried Plantain Half Tray",60],["Moimoi (12 pieces)",60],["Moimoi (Full Tray)",120],
  ["Stewed Chicken Full Tray",160],["Stewed Chicken Half Tray",80],
  ["Chicken Soup Full Tray",140],["Chicken Soup Half Tray",70],
  ["Ogbono Soup Full Tray",360],["Ogbono Soup Half Tray",180],
  ["Puff-Puff Full Tray",80],["Puff-Puff Half Tray",50],
  ["Salad Full Tray",120],["Salad Half Tray",60],
  ["Suya (Beef Brisket) Full Tray",350],["Suya (Beef Brisket) Half Tray",180],
  ["Akara (Beans Cake) Full Tray",120],["Akara (Beans Cake) Half Tray",60],
  ["Amala (wrap) per 1",4],["Poundo (wrap) per 1",4],["Pounded Yam (wrap) per 1",7],
  ["Buka Stew Full Tray",300],["Buka Stew Half Tray",150],
  ["Chin-Chin Full Tray",140],["Chin-Chin Half Tray",70],
  ["Curry Chicken Full Tray",150],["Curry Chicken Half Tray",80],
  ["Edikaikong Soup Full Tray",360],["Edikaikong Soup Half Tray",180],
  ["Vegetable Soup (Efo Riro) Full Tray",360],["Vegetable Soup (Efo Riro) Half Tray",180],
  ["Okro Soup Full Tray",300],["Okro Soup Half Tray",150],
  ["Banga Soup Half Tray",150],["Banga Soup Full Tray",300],
  ["Pepper Soup (Goat Meat) Full Tray",200],["Pepper Soup (Goat Meat) Half Tray",100]
].map(([name, price]) => ({ name, price }));

function money(n) {
  return Number(n).toFixed(2);
}

async function wave(query, variables) {
  const token = process.env.WAVE_ACCESS_TOKEN;
  if (!token) throw new Error("WAVE_ACCESS_TOKEN is not configured.");
  const r = await fetch(WAVE_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });
  const body = await r.json();
  if (!r.ok || body.errors?.length) {
    throw new Error(body.errors?.map(e => e.message).join("; ") || `Wave API HTTP ${r.status}`);
  }
  return body.data;
}

async function findCustomer(email) {
  const q = `query ($businessId: ID!, $email: String) {
    business(id: $businessId) {
      customers(page: 1, pageSize: 10, email: $email) {
        edges { node { id name email } }
      }
    }
  }`;
  const data = await wave(q, { businessId: process.env.WAVE_BUSINESS_ID, email });
  return data.business?.customers?.edges?.[0]?.node || null;
}

async function createCustomer(customer) {
  const q = `mutation ($input: CustomerCreateInput!) {
    customerCreate(input: $input) {
      didSucceed
      inputErrors { message code path }
      customer { id name email }
    }
  }`;
  const data = await wave(q, {
    input: {
      businessId: process.env.WAVE_BUSINESS_ID,
      name: customer.name,
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      mobile: customer.phone || null
    }
  });
  const out = data.customerCreate;
  if (!out.didSucceed) throw new Error(out.inputErrors?.map(e => e.message).join("; ") || "Could not create customer in Wave.");
  return out.customer;
}

async function findIncomeAccount() {
  // Use the account explicitly configured in Render when available.
  // Otherwise, automatically use the first active INCOME account in Wave.
  if (process.env.WAVE_INCOME_ACCOUNT_ID) return process.env.WAVE_INCOME_ACCOUNT_ID;

  const q = `query ($businessId: ID!, $page: Int!, $pageSize: Int!) {
    business(id: $businessId) {
      accounts(page: $page, pageSize: $pageSize, subtypes: [INCOME, OTHER_INCOME]) {
        edges {
          node { id name isArchived subtype { value } }
        }
      }
    }
  }`;
  const data = await wave(q, {
    businessId: process.env.WAVE_BUSINESS_ID,
    page: 1,
    pageSize: 50
  });
  const account = data.business?.accounts?.edges?.map(e => e.node)
    .find(a => !a.isArchived);
  if (!account) {
    throw new Error(
      "No active Wave income account was found. Add WAVE_INCOME_ACCOUNT_ID in Render Environment, using an account with subtype INCOME or OTHER_INCOME."
    );
  }
  return account.id;
}

async function findOrCreateProduct(item) {
  const incomeAccountId = await findIncomeAccount();

  const q = `query ($businessId: ID!, $page: Int!, $pageSize: Int!) {
    business(id: $businessId) {
      products(page: $page, pageSize: $pageSize, isArchived: false) {
        edges {
          node {
            id name unitPrice
            incomeAccount { id name }
          }
        }
      }
    }
  }`;
  const data = await wave(q, { businessId: process.env.WAVE_BUSINESS_ID, page: 1, pageSize: 100 });
  const existing = data.business?.products?.edges?.map(e => e.node)
    .find(p => p.name.toLowerCase() === item.name.toLowerCase());

  if (existing) {
    // Products created before this fix may not have an income account.
    // Patch those products so Wave can use them on invoices.
    if (!existing.incomeAccount?.id) {
      const patch = `mutation ($input: ProductPatchInput!) {
        productPatch(input: $input) {
          didSucceed
          inputErrors { message code path }
          product { id name unitPrice incomeAccount { id name } }
        }
      }`;
      const patched = await wave(patch, {
        input: { id: existing.id, incomeAccountId }
      });
      const out = patched.productPatch;
      if (!out.didSucceed) {
        throw new Error(out.inputErrors?.map(e => e.message).join("; ") || `Could not set income account for Wave product ${item.name}.`);
      }
      return out.product;
    }
    return existing;
  }

  const m = `mutation ($input: ProductCreateInput!) {
    productCreate(input: $input) {
      didSucceed
      inputErrors { message code path }
      product { id name unitPrice incomeAccount { id name } }
    }
  }`;
  const created = await wave(m, {
    input: {
      businessId: process.env.WAVE_BUSINESS_ID,
      name: item.name,
      unitPrice: money(item.price),
      description: "Kendis Kitchen menu item",
      incomeAccountId
    }
  });
  const out = created.productCreate;
  if (!out.didSucceed) throw new Error(out.inputErrors?.map(e => e.message).join("; ") || `Could not create Wave product ${item.name}.`);
  return out.product;
}

app.get("/api/menu", (_req, res) => res.json(MENU));

app.post("/api/order", async (req, res) => {
  try {
    const { customer, items, pickupDate, pickupTime, notes } = req.body;
    if (!process.env.WAVE_BUSINESS_ID || !process.env.WAVE_ACCESS_TOKEN) {
      return res.status(500).json({ error: "Wave is not connected yet. Add the Wave access token and Kendis Kitchen business ID in Render." });
    }
    if (!customer?.name || !customer?.email || !pickupDate || !pickupTime) {
      return res.status(400).json({ error: "Please provide name, email, pickup date, and pickup time." });
    }
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "Please select at least one menu item." });
    }

    const normalized = items.map(i => {
      const menuItem = MENU.find(m => m.name === i.name);
      const quantity = Math.max(1, Number(i.quantity || 1));
      if (!menuItem) throw new Error(`Menu item not found: ${i.name}`);
      return { ...menuItem, quantity };
    });

    const subtotal = normalized.reduce((s, i) => s + i.price * i.quantity, 0);
    const waveCustomer = await (await findCustomer(customer.email)) || await createCustomer(customer);

    const invoiceItems = [];
    for (const item of normalized) {
      const product = await findOrCreateProduct(item);
      invoiceItems.push({
        productId: product.id,
        quantity: String(item.quantity),
        unitPrice: money(item.price)
      });
    }

    const memo = [
      `Kendis Kitchen online order`,
      `Pickup: ${pickupDate} at ${pickupTime}`,
      notes ? `Customer notes: ${notes}` : ""
    ].filter(Boolean).join("\n");

    const mutation = `mutation ($input: InvoiceCreateInput!) {
      invoiceCreate(input: $input) {
        didSucceed
        inputErrors { message code path }
        invoice {
          id invoiceNumber viewUrl
          total { value currency { symbol } }
          amountDue { value currency { symbol } }
        }
      }
    }`;

    const invoiceData = await wave(mutation, {
      input: {
        businessId: process.env.WAVE_BUSINESS_ID,
        customerId: waveCustomer.id,
        status: "SAVED",
        items: invoiceItems,
        memo,
        // Keep bank payments disabled. Wave's card setting controls card payments.
        disableBankPayments: true,
        disableCreditCardPayments: false,
        requireTermsOfServiceAgreement: true
      }
    });

    const invoice = invoiceData.invoiceCreate.invoice;
    if (!invoiceData.invoiceCreate.didSucceed || !invoice) {
      throw new Error(invoiceData.invoiceCreate.inputErrors?.map(e => e.message).join("; ") || "Wave could not create the invoice.");
    }

    const eventTitle = `Kendis Kitchen Order ${invoice.invoiceNumber || ""}`.trim();
    const details = `Kendis Kitchen order\\nWave invoice: ${invoice.viewUrl}\\nTotal: $${money(subtotal)}\\n${normalized.map(i => `${i.quantity} × ${i.name}`).join("\\n")}${notes ? `\\nNotes: ${notes}` : ""}`;
    const start = `${pickupDate.replaceAll("-", "")}T${pickupTime.replace(":", "")}00`;
    const calendarUrl =
      "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      `&text=${encodeURIComponent(eventTitle)}` +
      `&dates=${encodeURIComponent(start + "/" + start)}` +
      `&details=${encodeURIComponent(details)}`;

    res.json({
      invoiceUrl: invoice.viewUrl,
      invoiceNumber: invoice.invoiceNumber,
      total: subtotal,
      calendarUrl,
      message: "Order created in Wave. Open the Wave invoice to pay by card."
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Something went wrong creating the order." });
  }
});

app.use((req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html'));});

app.listen(PORT, () => console.log(`Kendis Kitchen order app running on port ${PORT}`));
