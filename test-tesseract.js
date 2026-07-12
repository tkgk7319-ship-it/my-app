import { createWorker } from "tesseract.js";

async function test() {
  try {
    const worker = await createWorker("jpn", 1, {
      logger: m => console.log(m),
    });
    console.log("Worker created successfully");
    await worker.terminate();
  } catch (err) {
    console.error("Error creating worker:", err);
  }
}

test();
