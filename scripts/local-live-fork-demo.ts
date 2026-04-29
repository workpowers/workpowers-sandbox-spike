const response = await fetch("http://localhost:8787/sessions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    repoUrl: process.cwd(),
    ref: "local",
    template: "node-pnpm-playwright-postgres",
    data: {
      mode: "local_seed",
      seedName: "basic-projects"
    }
  })
});

if (!response.ok) {
  throw new Error(await response.text());
}

console.log(await response.json());
