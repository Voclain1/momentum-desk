// A local stand-in for payment providers' APIs and checkout pages, for
// end-to-end tests only (PAYMENTS_TEST_API, lib/payments/http.ts). It plays
// Paystack: initialise a transaction, show a checkout page where "Pay"
// succeeds, and answer verify calls. It also plays the Anthropic Messages
// API for Momentum AI (AI_TEST_API), answering from the facts in the prompt.
// Nothing here is used outside tests.
import { createServer } from "node:http";

const port = Number(process.env.MOCK_PROVIDERS_PORT ?? 3200);
const transactions = new Map();
const refunds = new Map();
let nextId = 1000;

const read = (request) =>
  new Promise((resolve) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => resolve(body));
  });
const json = (response, status, value) => {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
};

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  if (url.pathname === "/health") return json(response, 200, { ok: true });

  if (request.method === "POST" && url.pathname === "/api.paystack.co/transaction/initialize") {
    const body = JSON.parse(await read(request));
    if (!String(request.headers.authorization ?? "").startsWith("Bearer sk_test_")) return json(response, 401, { message: "Invalid key" });
    transactions.set(body.reference, { ...body, id: nextId++, status: "ongoing" });
    return json(response, 200, { status: true, data: { authorization_url: `http://localhost:${port}/pay/${body.reference}`, reference: body.reference } });
  }

  const verify = /^\/api\.paystack\.co\/transaction\/verify\/(.+)$/.exec(url.pathname);
  if (request.method === "GET" && verify) {
    const tx = transactions.get(decodeURIComponent(verify[1]));
    if (!tx) return json(response, 404, { status: false, message: "Transaction reference not found" });
    return json(response, 200, {
      status: true,
      data: { id: tx.id, status: tx.status, reference: tx.reference, amount: Number(tx.amount), currency: tx.currency, channel: "card" },
    });
  }

  // Refunds start pending and are processed by the time anyone asks again.
  if (request.method === "POST" && url.pathname === "/api.paystack.co/refund") {
    const body = JSON.parse(await read(request));
    const id = nextId++;
    refunds.set(String(id), { ...body, id });
    return json(response, 200, { status: true, data: { id, status: "pending", amount: Number(body.amount) } });
  }
  const refund = /^\/api\.paystack\.co\/refund\/(.+)$/.exec(url.pathname);
  if (request.method === "GET" && refund) {
    const found = refunds.get(refund[1]);
    if (!found) return json(response, 404, { status: false, message: "Refund not found" });
    return json(response, 200, { status: true, data: { id: found.id, status: "processed" } });
  }

  const pay = /^\/pay\/(.+)$/.exec(url.pathname);
  if (pay) {
    const tx = transactions.get(decodeURIComponent(pay[1]));
    if (!tx) return json(response, 404, { message: "Unknown checkout" });
    if (request.method === "POST") {
      tx.status = "success";
      response.writeHead(303, { Location: tx.callback_url });
      return response.end();
    }
    response.writeHead(200, { "Content-Type": "text/html" });
    return response.end(
      `<!doctype html><title>Test checkout</title><h1>Test checkout</h1><p>${tx.currency} ${tx.amount} (subunits) for ${tx.email}</p>` +
        `<form method="post"><button>Pay</button></form>`,
    );
  }
  if (request.method === "POST" && url.pathname === "/v1/messages") {
    const body = JSON.parse(await read(request));
    const prompt = body.messages[0].content;
    const fact = (label) => new RegExp(`^${label}: (.+)$`, "m").exec(prompt)?.[1] ?? "";
    let answer;
    if (prompt.includes("Help the person who owns this lead")) {
      answer = {
        summary: `${fact("Company")} needs: ${fact("What they need")}. Estimated value: ${fact("Estimated value")}.`,
        nextAction: { action: "call", timing: "this_week", reason: "Confirm what they need and when." },
        followUp: { subject: `Following up, ${fact("Business")}`, body: `Hello ${fact("Contact")},\n\nThank you for your interest. When would suit you for a call?\n\n${fact("Business")}` },
      };
    } else if (prompt.includes("Propose quote lines")) {
      const product = /^- ([0-9a-f-]{36}) \| ([^|]+) \|/m.exec(prompt);
      const request = prompt.split("The customer's request (their words):\n")[1].split("\n")[0];
      const quantity = /\b(\d+)\b/.exec(request)?.[1] ?? "1";
      answer = {
        lines: [
          ...(product ? [{ productId: product[1], description: product[2].trim(), quantity }] : []),
          { productId: null, description: "Installation", quantity: "1" },
        ],
        questions: ["When would you like the work done?"],
      };
    } else if (prompt.includes("Draft an email from the business")) {
      answer = {
        subject: `Invoice ${fact("Invoice")}`,
        body: `Hello,\n\n${fact("Outstanding")} is outstanding on invoice ${fact("Invoice")}. Please let us know when you can pay.\n\n${fact("Business")}`,
      };
    } else {
      const first = /^- (\S+) \| ([^|]+) \| ([^|]+) outstanding/m.exec(prompt);
      answer = {
        summary: first ? `${first[3]} is outstanding on ${first[1]} from ${first[2].trim()}.` : "Nothing is overdue.",
        priorities: first ? [{ invoiceNumber: first[1], reason: "The most overdue." }] : [],
      };
    }
    return json(response, 200, {
      id: `msg_${nextId++}`, type: "message", role: "assistant", model: body.model,
      content: [{ type: "text", text: JSON.stringify(answer) }],
      stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 1200, output_tokens: 300 },
    });
  }
  json(response, 404, { message: "Not mocked" });
}).listen(port, () => console.log(`mock providers on ${port}`));
