
async function run() {
  const email = "test2@example.com";
  const pw = "$2B$10$abcdefghijklmnopqrstuv";
  
  // Register
  const resReg = await fetch("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pw })
  });
  console.log("Register:", await resReg.text());

  // Login
  const resLog = await fetch("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pw })
  });
  console.log("Login:", await resLog.text());
}
run();

