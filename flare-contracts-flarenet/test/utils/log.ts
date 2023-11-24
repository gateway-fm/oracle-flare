const verbose = true;

export function log(...S: any[]) {
  if (verbose) {
    console.log(...S);
  }
};
