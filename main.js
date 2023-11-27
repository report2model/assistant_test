// Import required dependencies
require("dotenv").config();
const OpenAI = require("openai");
const readline = require("readline").createInterface({
  input: process.stdin,
  output: process.stdout,
});
const fs = require('fs');

// Create OpenAI API connection
const secretKey = process.env.OPENAI_API_KEY;
const openai = new OpenAI({
  apiKey: secretKey,
});

// Utility function to ask a question in the console
async function askQuestion(prompt) {
  return new Promise((resolve) => {
    readline.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

// List all available assistants
async function listAssistants() {
  try {
    let response = await openai.beta.assistants.list();
    return response.data;
  } catch (error) {
    console.error('Error listing assistants:', error);
    process.exit(1);
  }
}

// Prompt user to select an assistant
async function selectAssistant(assistants) {
  const selection = await askQuestion("Which assistant would you like to use? Please enter the name: ");
  const selectedAssistant = assistants.find(assistant => assistant.name === selection);
  if (selectedAssistant) {
    return selectedAssistant;
  } else {
    console.log('Assistant not found. Please try again.');
    return selectAssistant(assistants); // Recursive call to ask again
  }
}

// Function to display available files for the chosen assistant by fetching from OpenAI API
async function displayFilesForAssistant(selectedAssistant) {
  console.log(`\nFiles available for assistant '${selectedAssistant.name}':`);

  try {
    // Fetch and display file details by iterating over file IDs associated with the assistant
    const associatedFilesPromises = selectedAssistant.file_ids.map((fileId) =>
      openai.files.retrieve(fileId)
    );
    const associatedFiles = await Promise.all(associatedFilesPromises);

    associatedFiles.forEach((file, index) => {
      console.log(`${index + 1}. ${file.filename} (ID: ${file.id})`);
    });

    return associatedFiles.map(file => file.id); // Return file IDs
  } catch (error) {
    console.error('Error fetching file information:', error);
  }
}

// Adjusted Function to create a new thread and handle user input
// This now supports "new" command to start over with a new assistant selection.
async function createThreadWithAssistant(fileIDs, selectedAssistant) {
  const thread = await openai.beta.threads.create();
  let keepGoing = true;
  while (keepGoing) {
    // Ask for user input
    const userInput = await askQuestion("\nInput: ");
    // Handle special commands
    if (userInput.trim().toLowerCase() === "exit") {
      keepGoing = false;
      return "exit"; // Indicate that user wants to exit
    } else if (userInput.trim().toLowerCase() === "new") {
      keepGoing = false;
      return "new"; // Indicate that user wants to select a new assistant
    }

    // Sending user input to the thread with file context, if any fileIDs are associated
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: userInput,
      ...(fileIDs.length ? { file_ids: fileIDs } : {}), // Include file_ids only if available
    });

    // Generate a response from the assistant
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: selectedAssistant.id,
    });

    // Fetch the assistant's response once it's ready
    let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    while (runStatus.status !== "completed") {
      await new Promise((resolve) => setTimeout(resolve, 1000)); // 1-second polling interval
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    }

    // If the run is completed, retrieve and display messages
    if (runStatus.status === "completed") {
      // Get the final set of messages from the Thread, including the Assistant's responses
      const messages = await openai.beta.threads.messages.list(thread.id);
      const lastMessageForRun = messages.data.filter(message => message.run_id === run.id && message.role === "assistant").pop();
      if (lastMessageForRun && lastMessageForRun.content.length) {
        console.log(`\nResponse:\n${lastMessageForRun.content.map(part => part.text?.value).join('')}`);
      } else {
        console.log("No response from the assistant or unable to retrieve the message.");
      }
    } else {
      // Handle non-completed run statuses
      console.log(`Run did not complete successfully. Status: ${runStatus.status}`);
    }
  }
  readline.close();
}

async function main() {
  try {
    // Retrieve available assistants
    const assistants = await listAssistants();
    // ... (rest of the main function code up to the assistant selection) ...
    
    let continueConversation = true;
    let selectedAssistant;
    let fileIDs;

    while (continueConversation) {
      if (!selectedAssistant) {
        // Prompt user to select an assistant if not already selected
        console.log("Available assistants are:", assistants.map(a => a.name).join(", "));
        selectedAssistant = await selectAssistant(assistants);
        // Display the available files for the chosen assistant
        fileIDs = await displayFilesForAssistant(selectedAssistant);
        console.log(`\nWelcome! You are now using the assistant: ${selectedAssistant.name}\n`);
      }

      // Create a thread and start a conversation with the assistant
      const threadResult = await createThreadWithAssistant(fileIDs, selectedAssistant);

      if (threadResult === "exit") {
        continueConversation = false; // End the conversation
      } else if (threadResult === "new") {
        selectedAssistant = null; // Reset the assistant selection
      }
    }

    console.log("\nGoodbye!\n");
  } catch (error) {
    // Handle any errors
    console.error('An error occurred:', error);
  } finally {
    // Ensure the readline interface is always closed cleanly
    readline.close();
  }
}

// Start the script by calling the main function
main();