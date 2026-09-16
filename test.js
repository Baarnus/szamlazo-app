
const pw = "$2B$10$abcdefghijklmnopqrstuv";
fetch("http://localhost:3000/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "test@example.com", password: pw })
})
.then(async r => {
  const text = await r.text();
  console.log("Status:", r.status);
  console.log("Body:", text.substring(0, 200));
});

