export function isPrime(n: number): boolean {
  if (!Number.isInteger(n) || n < 2) {
    return false;
  }

  if (n === 2) {
    return true;
  }

  if (n % 2 === 0) {
    return false;
  }

  const limit = Math.floor(Math.sqrt(n));
  for (let divisor = 3; divisor <= limit; divisor += 2) {
    if (n % divisor === 0) {
      return false;
    }
  }

  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rawValue = process.argv[2];
  const value = Number(rawValue);

  if (rawValue === undefined || Number.isNaN(value)) {
    console.error("Usage: tsx src/prime.ts <integer>");
    process.exit(1);
  }

  console.log(isPrime(value) ? `${value} is prime` : `${value} is not prime`);
}
