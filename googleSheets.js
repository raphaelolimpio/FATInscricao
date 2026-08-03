// googleSheets.js
const { google } = require("googleapis");
require("dotenv").config();

const rawKey = process.env.GOOGLE_PRIVATE_KEY || "";
const privateKey = rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;

const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: privateKey,
    },
    // Adicionado escopo do Google Sheets
    scopes: [
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/spreadsheets"
    ]
});

const sheets = google.sheets({ version: "v4", auth });

/**
 * Adiciona uma nova linha no final da planilha (Thread-safe no lado do Google)
 */
async function appendLinhaPlanilha(dadosLinha) {
    const spreadsheetId = process.env.GOOGLE_DRIVE_FILE_ID; // ID da sua planilha Google Sheets

    await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "Inscrições!A:P",
        valueInputOption: "USER_ENTERED",
        requestBody: {
            values: [dadosLinha]
        }
    });
}

/**
 * Busca os dados de um piloto pelo Pix ID lendo diretamente do Google Sheets
 */
async function getDadosPilotoByPixId(pixId) {
    const spreadsheetId = process.env.GOOGLE_DRIVE_FILE_ID;
    
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "Inscrições!A:P",
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) return null;

    // Procura a linha com o Pix ID correto (Coluna N / índice 13)
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row[13] === pixId) {
            return {
                name_do_piloto: row[1],
                cpf_do_piloto: row[2],
                email: row[3],
                telefone: row[4],
                numero_da_cba: row[5],
                idade: row[6],
                nome_do_responsavel: row[7],
                cpf_do_responsavel: row[8],
                numero_do_piloto: row[9],
                categoria: row[10],
                tamanho_Camisa: row[11],
                amount: Number(row[12]) * 100,
                status: row[14]
            };
        }
    }
    return null;
}

/**
 * Atualiza o status do pagamento diretamente na célula do Google Sheets
 */
async function atualizarStatusPlanilha(pixId, novoStatus) {
    const spreadsheetId = process.env.GOOGLE_DRIVE_FILE_ID;
    
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "Inscrições!A:P",
    });

    const rows = response.data.values;
    if (!rows) return;

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row[13] === pixId && row[14] !== novoStatus) {
            const rowNum = i + 1; // Ajuste do índice baseado em 1
            const dataPagamento = new Date().toLocaleString('pt-BR');

            // Atualiza apenas o Status (Coluna O) e a Data (Coluna P)
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `Inscrições!O${rowNum}:P${rowNum}`,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [[novoStatus, dataPagamento]]
                }
            });
            console.log(`Status do Pix ID ${pixId} atualizado para "${novoStatus}".`);
            break;
        }
    }
}

module.exports = {
    appendLinhaPlanilha,
    getDadosPilotoByPixId,
    atualizarStatusPlanilha
};