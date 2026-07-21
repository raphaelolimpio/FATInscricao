const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const arquivoConfig = path.join(__dirname, "driveFile.json");
require("dotenv").config();

const auth = new google.auth.GoogleAuth({
    keyFile: "credenciais-google.json",
    scopes: ["https://www.googleapis.com/auth/drive"]
});

const drive = google.drive({
    version: "v3",
    auth
});

async function enviarArquivo(caminhoArquivo, nomeArquivo) {

    const fileId = getFileId();

    const media = {

        mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",

        body: fs.createReadStream(caminhoArquivo)

    };

    if (!fileId) {

        console.log("Criando arquivo no Drive...");

        const response = await drive.files.create({

            resource: {

                name: nomeArquivo,

                parents: [
                    process.env.GOOGLE_DRIVE_FOLDER_ID
                ]

            },

            media,

            fields: "id"

        });

        salvarFileId(response.data.id);

        console.log("Arquivo criado!");

        return response.data.id;

    }

    console.log("Atualizando arquivo existente...");

    await drive.files.update({

        fileId,

        media

    });

    console.log("Arquivo atualizado!");

    return fileId;

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

module.exports = {
    enviarArquivo
};