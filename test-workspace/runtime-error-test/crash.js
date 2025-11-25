// Node.js script that crashes with stderr output and specific exit code

console.error("ERROR: Starting application with intentional crash");
console.error("ERROR: Critical failure in initialization");
console.error("ERROR: Database connection failed");
console.error("FATAL: Unrecoverable error - exiting with code 42");

// Simulate some runtime work
setTimeout(() => {
  console.log("This should run before crash");

  // Write to stderr and exit with specific code
  console.error("CRASH: Application terminated unexpectedly");
  process.exit(42);
}, 100);
