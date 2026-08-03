const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const arquivoConfig = path.join(__dirname, "driveFile.json");
require("dotenv").config();

const rawKey = process.env.GOOGLE_PRIVATE_KEY || "";
const privateKey = rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;

const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: privateKey,
    },
    scopes: ["https://www.googleapis.com/auth/drive"]
});

const drive = google.drive({
    version: "v3",
    auth
});

async function enviarArquivo(caminhoArquivo, nomeArquivo) {

    const fileId = process.env.GOOGLE_DRIVE_FILE_ID || getFileId();

    const media = {

        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",

        body: fs.createReadStream(caminhoArquivo)

    };

    if (!fileId) {

        console.log("Nenhum ID de planilha configurado em GOOGLE_DRIVE_FILE_ID.");
        return null;
    }
    console.log("Atualizando planilha existente no Google Drive...");

    await drive.files.update({
        fileId: fileId,
        media: media,
        supportsAllDrives: true
    });


    console.log("Arquivo criado!");

    return fileId;

}
async function baixarArquivoDrive(caminhoDestinoLocal) {
    const driveFileId = process.env.GOOGLE_DRIVE_FILE_ID;
    if(!driveFileId) {
        console.error("GOOGLE_DRIVE_FILE_ID não está definida");
        return;
    }

    const response = await drive.files.get(
        {fileId: driveFileId, alt: "media"},
        {responseType: "stream"}
    );

    return new Promise((resolve, reject) => {
        const dest = fs.createWriteStream(caminhoDestinoLocal);
        response.data
            .on("end", () => resolve())
            .on("error", (err) => reject(err))
            .pipe(dest);
    });
}


function getFileId() {
    if (!fs.existsSync(arquivoConfig))
        return null;
    const dados = JSON.parse(
        fs.readFileSync(arquivoConfig)
    );
    return dados.fields || null;
}

function salvarFileId(fields) {
    fs.writeFileSync(
        arquivoConfig,
        JSON.stringify({
            fields
        }, null, 4)
    );
}

async function buscarArquivo(folderId) {
    const response = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        orderBy: "modifiedTime desc",
        fields: "files(id,name,mimeType)",
        pageSize: 1
    });
    if (response.data.files.length === 0) {
        return null;
    }
    return response.data.files[0];

}

async function buscarBanner() {
    return await buscarArquivo(
        process.env.GOOGLE_DRIVE_FOLDER_BANNER_ID
    );
}

async function buscarRegulamento() {
    return await buscarArquivo(
        process.env.GOOGLE_DRIVE_FOLDER_REGULAMENTO_ID
    );

}

async function baixarArquivo(fileId, res) {
    const arquivo = await drive.files.get(
        {
            fileId,
            alt: "media"
        },
        {
            responseType: "stream"
        }
    );

    arquivo.data.pipe(res);

}

module.exports = {
    enviarArquivo,
    buscarArquivo,
    buscarBanner,
    buscarRegulamento,
    baixarArquivo,
    baixarArquivoDrive
};