import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function parseIptablesIntent(intent: string, currentRules: string) {
  const model = "gemini-3-flash-preview";
  
  const prompt = `
    You are an expert IPTables administrator.
    Convert the following natural language intent into a valid and SECURE iptables command.
    
    Intent: "${intent}"
    Current Rules Context:
    ${currentRules}
    
    Requirements:
    1. Output only the exact command.
    2. CHECK THE "Current Rules Context": If the intended rule (or a functionally identical one) ALREADY EXISTS, DO NOT generate an add command. Instead, return "EXISTS: Rule already present in current chain".
    3. Ensure the rule is safe and doesn't lock out the administrator.
    4. Use standard iptables syntax (e.g., iptables -A INPUT ...).
    5. If the intent is ambiguous or dangerous, provide an explanation instead starting with "ERROR: ".
    
    If the command to be generated involves updating/deleting by number, ensure the numbers are correct based on the provided context.
  `;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      temperature: 0.1,
    }
  });

  return response.text?.trim() || "ERROR: Could not generate command";
}

export async function explainRules(rules: string) {
  const model = "gemini-3-flash-preview";
  
  const prompt = `
    Explain the following iptables rules in simple, non-technical human language. 
    Highlight any potential security risks or misconfigurations.
    
    Rules:
    ${rules}
    
    Structure the explanation in brief bullet points.
  `;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
  });

  return response.text?.trim() || "No explanation available.";
}

export async function modifyConfigFile(intent: string, currentFileContent: string) {
  const model = "gemini-3.1-pro-preview";
  
  const prompt = `
    You are an expert IPTables administrator.
    You will be given the content of an iptables-save format configuration file.
    Modify this file content based on the user intent.
    
    User Intent: "${intent}"
    
    Current File Content:
    ${currentFileContent}
    
    Requirements:
    1. Output ONLY the complete updated file content in standard iptables-save format.
    2. DO NOT use the "iptables" command prefix. Rules must start with "-A", "-I", etc. (e.g., "-A INPUT -i lo -j ACCEPT").
    3. Maintain the full structure: Start with "*filter", include chain policies (e.g., ":INPUT ACCEPT [0:0]"), and end with "COMMIT".
    4. IDEMPOTENCY CHECK: Do NOT add a rule if a functionally identical one already exists.
    5. Ensure no critical rules (like SSH/Port 22) are removed accidentally.
    6. If the request is already satisfied, return the original content.
    7. Start with "ERROR: " only if the request is impossible or dangerous.
  `;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      temperature: 0.1,
    }
  });

  return response.text?.trim() || "ERROR: Could not modify configuration file";
}
