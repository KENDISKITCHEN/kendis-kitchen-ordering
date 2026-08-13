import express from "express";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 10000;
const WAVE_ENDPOINT = "https://gql.waveapps.com/graphql/public";
const processedPaymentEvents = new Set();
const receiptSentInvoices = new Set();
const receiptInFlight = new Map();

const MENU = [
  ["Rice & Sides","Jollof Rice Full Tray",80],["Rice & Sides","Jollof Rice Half Tray",50],
  ["Rice & Sides","Fried Rice Full Tray",120],["Rice & Sides","Fried Rice Half Tray",60],
  ["Rice & Sides","Fried Plantain Full Tray",120],["Rice & Sides","Fried Plantain Half Tray",60],
  ["Rice & Sides","Salad Full Tray",120],["Rice & Sides","Salad Half Tray",60],
  ["Meat & Chicken","Assorted Beef Full Tray",350],["Meat & Chicken","Full Beef Tray",400],
  ["Meat & Chicken","Stewed Chicken Full Tray",160],["Meat & Chicken","Stewed Chicken Half Tray",80],
  ["Meat & Chicken","Suya (Beef Brisket) Full Tray",350],["Meat & Chicken","Suya (Beef Brisket) Half Tray",180],
  ["Meat & Chicken","Curry Chicken Full Tray",150],["Meat & Chicken","Curry Chicken Half Tray",80],
  ["Soups & Stews","Bitter Leaf Half Tray",180],["Soups & Stews","Ayamase (Designer) Stew Full Tray",360],
  ["Soups & Stews","Ayamase (Designer) Stew Half Tray",180],["Soups & Stews","Buka Stew Full Tray",300],
  ["Soups & Stews","Buka Stew Half Tray",150],["Soups & Stews","Chicken Soup Full Tray",140],
  ["Soups & Stews","Chicken Soup Half Tray",70],["Soups & Stews","Ogbono Soup Full Tray",360],
  ["Soups & Stews","Ogbono Soup Half Tray",180],["Soups & Stews","Edikaikong Soup Full Tray",360],
  ["Soups & Stews","Edikaikong Soup Half Tray",180],["Soups & Stews","Vegetable Soup (Efo Riro) Full Tray",360],
  ["Soups & Stews","Vegetable Soup (Efo Riro) Half Tray",180],["Soups & Stews","Okro Soup Full Tray",300],
  ["Soups & Stews","Okro Soup Half Tray",150],["Soups & Stews","Banga Soup Full Tray",300],
  ["Soups & Stews","Banga Soup Half Tray",150],["Soups & Stews","Pepper Soup (Goat Meat) Full Tray",200],
  ["Soups & Stews","Pepper Soup (Goat Meat) Half Tray",100],
  ["Swallows","Amala (wrap) per 1",4],["Swallows","Poundo (wrap) per 1",4],["Swallows","Pounded Yam (wrap) per 1",7],
  ["Small Chops & Snacks","Moimoi (12 pieces)",60],["Small Chops & Snacks","Moimoi (Full Tray)",120],
  ["Small Chops & Snacks","Akara (Beans Cake) Full Tray",120],["Small Chops & Snacks","Akara (Beans Cake) Half Tray",60],
  ["Small Chops & Snacks","Puff-Puff Full Tray",80],["Small Chops & Snacks","Puff-Puff Half Tray",50],
  ["Small Chops & Snacks","Chin-Chin Full Tray",140],["Small Chops & Snacks","Chin-Chin Half Tray",70]
].map(([category,name,price]) => ({ category, name, price }));

function money(n){ return Number(n).toFixed(2); }

async function wave(query, variables){
  const token = process.env.WAVE_ACCESS_TOKEN;
  if(!token) throw new Error("WAVE_ACCESS_TOKEN is not configured.");
  const r = await fetch(WAVE_ENDPOINT, {
    method:"POST",
    headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" },
    body:JSON.stringify({query,variables})
  });
  const body = await r.json();
  if(!r.ok || body.errors?.length) throw new Error(body.errors?.map(e=>e.message).join("; ") || `Wave API HTTP ${r.status}`);
  return body.data;
}

async function findCustomer(email){
  const q = `query ($businessId: ID!, $email: String) { business(id:$businessId) { customers(page:1,pageSize:10,email:$email) { edges { node { id name email } } } } }`;
  const data = await wave(q,{businessId:process.env.WAVE_BUSINESS_ID,email});
  return data.business?.customers?.edges?.[0]?.node || null;
}

async function createCustomer(customer){
  const q = `mutation ($input: CustomerCreateInput!) { customerCreate(input:$input) { didSucceed inputErrors { message code path } customer { id name email } } }`;
  const data = await wave(q,{input:{businessId:process.env.WAVE_BUSINESS_ID,name:customer.name,email:customer.email,mobile:customer.phone||null}});
  const out=data.customerCreate;
  if(!out.didSucceed) throw new Error(out.inputErrors?.map(e=>e.message).join("; ") || "Could not create customer in Wave.");
  return out.customer;
}

async function findIncomeAccount(){
  if(process.env.WAVE_INCOME_ACCOUNT_ID) return process.env.WAVE_INCOME_ACCOUNT_ID;
  const q=`query ($businessId:ID!,$page:Int!,$pageSize:Int!){ business(id:$businessId){ accounts(page:$page,pageSize:$pageSize,subtypes:[INCOME,OTHER_INCOME]){ edges{node{id name isArchived subtype{value}}} } } }`;
  const data=await wave(q,{businessId:process.env.WAVE_BUSINESS_ID,page:1,pageSize:50});
  const account=data.business?.accounts?.edges?.map(e=>e.node).find(a=>!a.isArchived);
  if(!account) throw new Error("No active Wave income account was found. Add WAVE_INCOME_ACCOUNT_ID in Render Environment.");
  return account.id;
}

async function findOrCreateProduct(item){
  const incomeAccountId=await findIncomeAccount();
  const q=`query ($businessId:ID!,$page:Int!,$pageSize:Int!){ business(id:$businessId){ products(page:$page,pageSize:$pageSize,isArchived:false){ edges{node{id name unitPrice incomeAccount{id name}}} } } }`;
  const data=await wave(q,{businessId:process.env.WAVE_BUSINESS_ID,page:1,pageSize:100});
  const existing=data.business?.products?.edges?.map(e=>e.node).find(p=>p.name.toLowerCase()===item.name.toLowerCase());
  if(existing){
    if(!existing.incomeAccount?.id){
      const patch=`mutation ($input:ProductPatchInput!){ productPatch(input:$input){ didSucceed inputErrors{message code path} product{id name unitPrice incomeAccount{id name}} } }`;
      const patched=await wave(patch,{input:{id:existing.id,incomeAccountId}});
      const out=patched.productPatch;
      if(!out.didSucceed) throw new Error(out.inputErrors?.map(e=>e.message).join("; ") || `Could not set income account for ${item.name}.`);
      return out.product;
    }
    return existing;
  }
  const m=`mutation ($input:ProductCreateInput!){ productCreate(input:$input){ didSucceed inputErrors{message code path} product{id name unitPrice incomeAccount{id name}} } }`;
  const created=await wave(m,{input:{businessId:process.env.WAVE_BUSINESS_ID,name:item.name,unitPrice:money(item.price),description:`Kendis Kitchen menu item — ${item.category}`,incomeAccountId}});
  const out=created.productCreate;
  if(!out.didSucceed) throw new Error(out.inputErrors?.map(e=>e.message).join("; ") || `Could not create Wave product ${item.name}.`);
  return out.product;
}

async function getInvoice(invoiceId){
  const q=`query ($businessId:ID!,$invoiceId:ID!){ business(id:$businessId){ invoice(id:$invoiceId){ id invoiceNumber viewUrl status memo customer{name email} payments{id amount paymentDate} amountDue{value currency{symbol code}} amountPaid{value currency{symbol code}} total{value currency{symbol code}} } } }`;
  const data=await wave(q,{businessId:process.env.WAVE_BUSINESS_ID,invoiceId});
  return data.business?.invoice || null;
}

async function sendPaymentReceipt(invoiceId){
  const invoice=await getInvoice(invoiceId);
  const email=invoice?.customer?.email;
  const payment=invoice?.payments?.[invoice.payments.length-1];
  if(!invoice || !email || !payment?.id){
    console.error("Payment receipt could not be sent: invoice, customer email, or payment ID missing.");
    return false;
  }
  const message=`Thank you for your payment to Kendis Kitchen.\n\nInvoice: ${invoice.invoiceNumber || invoiceId}\nAmount paid: $${money(payment.amount)}\n\n${invoice.memo || "Your Kendis Kitchen order has been paid in full."}\n\nYour payment receipt is attached. We look forward to serving you!`;
  const q=`mutation ($input:InvoicePaymentReceiptSendInput!){ invoicePaymentReceiptSend(input:$input){ didSucceed inputErrors{message code path} } }`;
  const data=await wave(q,{input:{invoiceId,invoicePaymentId:payment.id,to:[email],subject:`Payment confirmed — Kendis Kitchen ${invoice.invoiceNumber || ""}`.trim(),message,attachPdf:true}});
  const out=data.invoicePaymentReceiptSend;
  if(!out.didSucceed){
    console.error("Wave payment receipt email failed:",out.inputErrors);
    return false;
  }
  console.log(`Payment receipt queued for ${email} for invoice ${invoice.invoiceNumber || invoiceId}`);
  return true;
}

async function sendPaymentReceiptOnce(invoiceId){
  if(receiptSentInvoices.has(invoiceId)) return true;
  if(receiptInFlight.has(invoiceId)) return receiptInFlight.get(invoiceId);
  const promise=(async()=>{
    try{
      const sent=await sendPaymentReceipt(invoiceId);
      if(sent) receiptSentInvoices.add(invoiceId);
      return sent;
    }finally{
      receiptInFlight.delete(invoiceId);
    }
  })();
  receiptInFlight.set(invoiceId,promise);
  return promise;
}

app.post("/api/wave-webhook",express.raw({type:"application/json",limit:"1mb"}),async(req,res)=>{
  try{
    const secret=process.env.WAVE_WEBHOOK_SECRET;
    if(!secret) return res.status(500).send("Webhook secret is not configured.");
    const signatureHeader=req.get("x-wave-signature")||"";
    const timestampHeader=req.get("x-wave-timestamp")||"";
    const parts=Object.fromEntries(signatureHeader.split(",").map(part=>part.split("=")).filter(pair=>pair.length===2));
    const timestamp=parts.t||timestampHeader;
    const receivedSignature=parts.v1;
    if(!timestamp||!receivedSignature) return res.status(400).send("Invalid webhook signature.");
    const timestampNumber=Number(timestamp);
    if(!Number.isFinite(timestampNumber)||Math.abs(Date.now()/1000-timestampNumber)>300) return res.status(400).send("Webhook timestamp outside tolerance window.");
    const rawBody=Buffer.isBuffer(req.body)?req.body.toString("utf8"):String(req.body||"");
    const expectedSignature=crypto.createHmac("sha256",secret).update(`${timestamp}.${rawBody}`,"utf8").digest("hex");
    const received=Buffer.from(receivedSignature,"utf8"),expected=Buffer.from(expectedSignature,"utf8");
    if(received.length!==expected.length||!crypto.timingSafeEqual(received,expected)) return res.status(401).send("Invalid webhook signature.");
    const event=JSON.parse(rawBody);
    console.log("Wave webhook received:",{eventType:event.event_type,eventId:event.event_id,invoiceId:event.data?.invoice_id,amountPaid:event.data?.amount_paid,remainingBalance:event.data?.remaining_balance});
    if(event.event_type==="invoice.paid"&&event.data?.invoice_id){
      const invoiceId=event.data.invoice_id;
      const key=event.event_id||invoiceId;
      if(!processedPaymentEvents.has(key)){
        const receiptSent=await sendPaymentReceiptOnce(invoiceId);
        if(!receiptSent) return res.status(500).send("Payment received, but receipt email could not be queued. Please retry webhook delivery.");
        processedPaymentEvents.add(key);
        if(processedPaymentEvents.size>1000) processedPaymentEvents.delete(processedPaymentEvents.values().next().value);
      }
    }
    return res.sendStatus(200);
  }catch(e){ console.error("Wave webhook error:",e); return res.status(400).send("Invalid webhook payload."); }
});

app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname,"public")));

app.get("/api/menu",(_req,res)=>res.json(MENU));

app.get("/api/invoice-status",async(req,res)=>{
  try{
    const invoiceId=String(req.query.invoiceId||"").trim();
    if(!invoiceId) return res.status(400).json({error:"invoiceId is required."});
    const invoice=await getInvoice(invoiceId);
    if(!invoice) return res.status(404).json({error:"Invoice not found."});
    const total=Number(invoice.total?.value||0),amountPaid=Number(invoice.amountPaid?.value||0),amountDue=Number(invoice.amountDue?.value||0);
    const paid=invoice.status==="PAID"||(total>0&&amountDue<=0&&amountPaid>=total);
    let receiptSent=false;
    if(paid){
      receiptSent=await sendPaymentReceiptOnce(invoiceId);
    }
    res.json({paid,status:invoice.status,invoiceNumber:invoice.invoiceNumber,total,amountPaid,amountDue,invoiceUrl:invoice.viewUrl,receiptSent});
  }catch(e){ console.error("Invoice status error:",e); res.status(500).json({error:e.message||"Could not retrieve invoice status."}); }
});

app.post("/api/order",async(req,res)=>{
  try{
    const {customer,items,pickupDate,pickupTime,notes}=req.body;
    if(!process.env.WAVE_BUSINESS_ID||!process.env.WAVE_ACCESS_TOKEN) return res.status(500).json({error:"Wave is not connected yet. Add the Wave access token and Kendis Kitchen business ID in Render."});
    if(!customer?.name||!customer?.email||!pickupDate||!pickupTime) return res.status(400).json({error:"Please provide name, email, pickup date, and pickup time."});
    if(!Array.isArray(items)||!items.length) return res.status(400).json({error:"Please select at least one menu item."});
    const normalized=items.map(i=>{
      const menuItem=MENU.find(m=>m.name===i.name);
      const quantity=Math.max(1,Number(i.quantity||1));
      if(!menuItem) throw new Error(`Menu item not found: ${i.name}`);
      return {...menuItem,quantity};
    });
    const subtotal=normalized.reduce((s,i)=>s+i.price*i.quantity,0);
    const waveCustomer=await (await findCustomer(customer.email))||await createCustomer(customer);
    const invoiceItems=[];
    for(const item of normalized){ const product=await findOrCreateProduct(item); invoiceItems.push({productId:product.id,quantity:String(item.quantity),unitPrice:money(item.price)}); }
    const memo=["Kendis Kitchen online order",`Pickup: ${pickupDate} at ${pickupTime}`,notes?`Customer notes: ${notes}`:""].filter(Boolean).join("\n");
    const mutation=`mutation ($input:InvoiceCreateInput!){ invoiceCreate(input:$input){ didSucceed inputErrors{message code path} invoice{id invoiceNumber viewUrl status disableCreditCardPayments disableBankPayments disableAmexPayments total{value currency{symbol}} amountDue{value currency{symbol}} amountPaid{value currency{symbol}}} } }`;
    const invoiceData=await wave(mutation,{input:{businessId:process.env.WAVE_BUSINESS_ID,customerId:waveCustomer.id,status:"SAVED",items:invoiceItems,memo,disableBankPayments:false,disableCreditCardPayments:false,disableAmexPayments:false,requireTermsOfServiceAgreement:false}});
    const invoice=invoiceData.invoiceCreate.invoice;
    if(!invoiceData.invoiceCreate.didSucceed||!invoice) throw new Error(invoiceData.invoiceCreate.inputErrors?.map(e=>e.message).join("; ")||"Wave could not create the invoice.");
    const eventTitle=`Kendis Kitchen Order ${invoice.invoiceNumber||""}`.trim();
    const details=`Kendis Kitchen order\nWave invoice: ${invoice.viewUrl}\nTotal: $${money(subtotal)}\n${normalized.map(i=>`${i.quantity} × ${i.name}`).join("\n")}${notes?`\nNotes: ${notes}`:""}`;
    const start=`${pickupDate.replaceAll("-","")}T${pickupTime.replace(":","")}00`;
    const calendarUrl="https://calendar.google.com/calendar/render?action=TEMPLATE"+`&text=${encodeURIComponent(eventTitle)}`+`&dates=${encodeURIComponent(start+"/"+start)}`+`&details=${encodeURIComponent(details)}`;
    res.json({invoiceId:invoice.id,invoiceUrl:invoice.viewUrl,invoiceNumber:invoice.invoiceNumber,total:subtotal,calendarUrl,message:"Order created in Wave. Use the Pay Now button on the hosted Wave invoice to complete payment."});
  }catch(e){ console.error(e); res.status(500).json({error:e.message||"Something went wrong creating the order."}); }
});

app.use((req,res)=>res.sendFile(path.join(__dirname,"index.html")));
app.listen(PORT,"0.0.0.0",()=>console.log(`Kendis Kitchen order app running on port ${PORT}`));
