const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const ExcelJS = require('exceljs');
const nodemailer = require('nodemailer');

require('dotenv').config();
const PDFDocument = require('pdfkit');
const path = require('path');

const {
    sheets,
    drive,
    enviarArquivo,
    buscarBanner,
    buscarRegulamento,
    baixarArquivo,
    baixarArquivoDrive
} = require('./googleDrive');

const app = express();
app.use(express.json());
app.use(cors());

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.use(express.static(path.join(__dirname)));

app.get("/health", (req, res) => {
    res.status(200).send("OK");
});


const API_KEY = process.env.ABACATEPAY_API_KEY;
const AUTORIZATION_API_KEY = process.env.AUTORIZATION_API_KEY;
const NOME_ARQUIVO_EXCEL = 'inscricoes_pilotos.xlsx';

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

async function salvarnaPlanilha(dadosPiloto, pixData) {
    try {
        const spreadsheetId = process.env.GOOGLE_DRIVE_FILE_ID;

        const novaLinha = [
            new Date().toLocaleString('pt-BR'),
            dadosPiloto.name_do_piloto || '',
            dadosPiloto.cpf_do_piloto || '',
            dadosPiloto.email || '',
            dadosPiloto.telefone || '',
            dadosPiloto.numero_da_cba || '',
            dadosPiloto.idade || '',
            dadosPiloto.nome_do_responsavel || 'N/A',
            dadosPiloto.cpf_do_responsavel || 'N/A',
            dadosPiloto.numero_do_piloto || '',
            dadosPiloto.categoria || '',
            dadosPiloto.tamanho_Camisa || '',
            (dadosPiloto.amount / 100),
            pixData.id || '',
            pixData.status || 'Pendente',
            '',
            dadosPiloto.lote || 1
        ];

        // O append trata concorrência de forma nativa no lado do Google
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: "Inscrições!A:Q",
            valueInputOption: "USER_ENTERED",
            requestBody: {
                values: [novaLinha]
            }
        });

        console.log(`Inscrição do piloto ${dadosPiloto.name_do_piloto} adicionada com sucesso!`);
    } catch (err) {
        console.error('Erro ao salvar na planilha:', err);
    }
}

app.get("/banner", async (req, res) => {
    const banner = await buscarBanner();

    if (!banner) {
        return res.status(404).send("banner não encontrado");
    }

    res.setHeader("Content-Type", "no-cache");
    res.setHeader("Content-Type", banner.mimeType);

    await baixarArquivo(banner.id, res);
});

app.get("/regulamento", async (req, res) => {
    const regulamento = await buscarRegulamento();

    if (!regulamento) {
        return res.status(404).send("Regulamento não encontrado");
    }

    res.setHeader("Content-Type", "no-cache");
    res.setHeader("Content-Type", regulamento.mimeType);

    res.setHeader(
        "Content-Disposition",
        `attachment; filename="${regulamento.name}"`
    );

    await baixarArquivo(regulamento.id, res);
});



app.post("/api/checkout", async (req, res) => {
    try {
        const dados = req.body;
        const categoria = (dados.categoria || "").trim();
        const totalPagos = await contarInscritosPagosCCategoria(categoria);
        console.log(`CAtegoria  ${categoria} possui ${totalPagos} inscriçoes pagas`);
        let valorPix = 0;
        let loteAplicado = 1;

        if (categoria === "Mirim" || categoria === "Cadete") {
            const LIMITE_LOTE_1 = 15;
            if (totalPagos < LIMITE_LOTE_1) {
                valorPix = 45000;
                loteAplicado = 1;
            } else {
                valorPix = 65000;
                loteAplicado = 2;
            }
        } else if (categoria === "Junior" || categoria === "Graduados" || categoria === "Senior") {
            const LIMITE_LOTE_1 = 15;
            if (totalPagos < LIMITE_LOTE_1) {
                valorPix = 60000;
                loteAplicado = 1;
            } else {
                valorPix = 160000;
                loteAplicado = 2;
            }
        } else {
            const LIMITE_LOTE_1 = 43;
            if (totalPagos < LIMITE_LOTE_1) {
                valorPix = 60000;
                loteAplicado = 1;
            } else {
                valorPix = 95000;
                loteAplicado = 2;
            }
        }

        dados.amount = valorPix;
        dados.lote = loteAplicado;

        const cpfLimpo = (dados.cpf_do_piloto || "").replace(/\D/g, '');
        const cpfRespLimpo = (dados.cpf_do_responsavel || "").replace(/\D/g, '');
        const idadePiloto = Number(dados.idade || 0);

        const ehMenordeIdade = idadePiloto < 18 || ["Cadete", "Mirim"].includes(categoria);

        let cpfParaCobranca = cpfLimpo;
        let nomeParaCobranca = dados.name_do_piloto;

        if (ehMenordeIdade) {
            if (cpfRespLimpo.length !== 11) {
                return res.status(400).json({
                    sucesso: false,
                    message: 'CPF do responsável inválido (deve conter 11 dígitos) para pilotos menores de idade.'
                });
            } else {
                if (cpfLimpo.length !== 11) {
                    return res.status(400).json({
                        sucesso: false,
                        message: 'CPF do piloto inválido (deve conter 11 dígitos).'
                    });
                }
            }
        }

        const clienteResponse = await axios.post(
            "https://api.abacatepay.com/v1/customer/create",
            {
                name: dados.name_do_piloto,
                email: dados.email,
                cellphone: dados.telefone ? dados.telefone.replace(/\D/g, '') : '',
                taxId: cpfParaCobranca,
            },
            {
                headers: {
                    Authorization: `Bearer ${API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const customerId = clienteResponse.data.data.id;

        console.log('Cliente criado com sucesso:', customerId);

        const pixResponse = await axios.post(
            "https://api.abacatepay.com/v1/pixQrCode/create",
            {
                amount: valorPix,
                description: `Inscrição do piloto ${dados.name_do_piloto}`,
                customerId: customerId,
            },
            {
                headers:
                {
                    Authorization: `Bearer ${API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        console.log("Pix criado:", pixResponse.data);

        const pixData = pixResponse.data.data;

        await salvarnaPlanilha(dados, {
            id: pixData.id,
            status: "Pendente",
        });


        return res.status(200).json({
            sucesso: true,
            message: 'Cobrança processada com sucesso',
            lote: loteAplicado,
            pixId: pixData.id,
            brCode: pixData.brCode,
            brCodeBase64: pixData.brCodeBase64
        });

    } catch (error) {
        console.error('Erro ao processar cobrança:', error.response?.data || error.message);
        res.status(500).json({
            sucesso: false,
            message: 'Erro ao processar cobrança'
        });
    }
});

app.get("/api/check-status/:pixId", async (req, res) => {
    try {
        const { pixId } = req.params;
        const response = await axios.get(
            `https://api.abacatepay.com/v2/transparents/check`,
            {
                params: { id: pixId },
                headers: {
                    Authorization: `Bearer ${AUTORIZATION_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        const status = response.data.data?.status;
        const dadosPiloto = await getDadosPilotoByPixId(pixId);

        if (!dadosPiloto) {
            return res.status(404).json({
                sucesso: false,
                message: 'Piloto não encontrado'
            });
        }


        if (status === 'PAID') {
            const atualizado = await atualizarStatusPlanilha(pixId, 'Pago');

            if(atualizado) {
                const pdf = await gerarComprovante(dadosPiloto, {
                    id: pixId,
                });
                try{
                    await enviarComprovanteEmail(dadosPiloto, pdf);
                } catch (emailErr) {
                    console.error('Erro ao enviar comprovante por e-mail:', emailErr.message);
                } finally {
                    if(fs.existsSync(pdf)) {
                        fs.unlinkSync(pdf);
                    }
                }
            }
        }
        return res.status(200).json({
            sucesso: true,
            status: status
        });
    } catch (err) {
        return res.status(500).json({
            err: 'Erro ao verificar status do pagamento',
        });
    }
});

async function contarInscritosPagosCCategoria(categoria){
    try {
        const spreadsheetId = process.env.GOOGLE_DRIVE_FILE_ID;

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: "Inscrições!A:P",
        });

        const rows = response.data.values;
        if (!rows || rows.length <= 1) return 0;

        let totalPagos = 0;
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const catRow = row[10] || '';
            const statusRow = row[14] || '';
            if (catRow.trim().toUpperCase() === categoria.trim().toUpperCase() && statusRow.trim() === 'Pago') {
                totalPagos++;
            }
        }
        return totalPagos;
    } catch (err) {
        console.error('Erro ao contar inscritos pagos:', err);
        return 0;
    }
}


async function atualizarStatusPlanilha(pixId, novoStatus) {
    try {
        const spreadsheetId = process.env.GOOGLE_DRIVE_FILE_ID;

        // 1. Busca os dados atuais da planilha
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: "Inscrições!A:P",
        });

        const rows = response.data.values;
        if (!rows) return;

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];

            if (row[13] === pixId && row[14] !== novoStatus) {
                const rowNum = i + 1;
                const dataPagamento = new Date().toLocaleString('pt-BR');

                await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `Inscrições!O${rowNum}:P${rowNum}`,
                    valueInputOption: "USER_ENTERED",
                    requestBody: {
                        values: [[novoStatus, dataPagamento]]
                    }
                });

                console.log(`Status do Pix ID ${pixId} atualizado para "${novoStatus}" na planilha.`);
                return true;
            }
        }
        return false;
    } catch (err) {
        console.error('Erro ao atualizar status na planilha:', err);
    }
}

function gerarComprovante(dadosPiloto, pixData) {
    return new Promise((resolve, reject) => {
        const pasta = path.join(__dirname, 'comprovantes');
        if (!fs.existsSync(pasta)) {
            fs.mkdirSync(pasta);
        }
        const nomeArquivo = `comprovante_${pixData.id}.pdf`;

        const caminho = path.join(__dirname, 'comprovantes', nomeArquivo);

        const doc = new PDFDocument({
            margin: 40
        });

        const stream = fs.createWriteStream(caminho);

        doc.pipe(stream);
        doc.fontSize(20).text('Comprovante de Inscrição', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12);
        doc.text(`Nome do Piloto: ${dadosPiloto.name_do_piloto}`);
        doc.text(`CPF do Piloto: ${dadosPiloto.cpf_do_piloto}`);
        doc.text(`Categoria: ${dadosPiloto.categoria}`);
        doc.text(`Tamanho da camisa: ${dadosPiloto.tamanho_Camisa}`);
        doc.text(`E-mail: ${dadosPiloto.email}`);
        doc.text(`Telefone: ${dadosPiloto.telefone}`);
        doc.moveDown();
        doc.text(`valor: R$ ${(dadosPiloto.amount / 100).toFixed(2)}`);
        doc.text(`Status: PAGO`);
        doc.text(`Data/Hora do Pagamento: ${new Date().toLocaleString('pt-BR')}`);
        doc.moveDown();
        doc.fontSize(15).text('Obrigado por se inscrever!', { align: 'center' });
        doc.end();

        stream.on('finish', () => {
            resolve(caminho);
        });
        stream.on('error', reject);
    })
}

async function getDadosPilotoByPixId(pixId) {
try {
        const spreadsheetId = process.env.GOOGLE_DRIVE_FILE_ID;

        // Lê todas as linhas diretamente do Google Sheets
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: "Inscrições!A:P",
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) return null;

        // Percorre as linhas procurando o ID do Pix (Coluna N = índice 13)
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            
            // Trata células vazias com fallback safe (|| '')
            if (row[13] === pixId) {
                return {
                    name_do_piloto: row[1] || '',
                    cpf_do_piloto: row[2] || '',
                    email: row[3] || '',
                    telefone: row[4] || '',
                    numero_da_cba: row[5] || '',
                    idade: row[6] || '',
                    nome_do_responsavel: row[7] || 'N/A',
                    cpf_do_responsavel: row[8] || 'N/A',
                    numero_do_piloto: row[9] || '',
                    categoria: row[10] || '',
                    tamanho_Camisa: row[11] || '',
                    amount: Number(row[12] || 0) * 100,
                    status: row[14] || 'Pendente'
                };
            }
        }
        return null;
    } catch (err) {
        console.error('Erro ao buscar piloto no Google Sheets:', err);
        return null;
    }

}

async function enviarComprovanteEmail(dadosPiloto, caminhoPdf) {

    await transporter.sendMail({

        from: `"Inscrições Kart" <${process.env.EMAIL_USER}>`,

        to: dadosPiloto.email,

        subject: "Comprovante de Inscrição",

        html: `
            <h2>Pagamento confirmado!</h2>

            <p>Olá <strong>${dadosPiloto.name_do_piloto}</strong>,</p>

            <p>Recebemos o pagamento da sua inscrição.</p>

            <p>O comprovante está em anexo.</p>

            <br>

            <p>Boa sorte na competição!</p>
        `,

        attachments: [
            {
                filename: "Comprovante_Inscricao.pdf",
                path: caminhoPdf
            }
        ]

    });

    console.log("Comprovante enviado para", dadosPiloto.email);
}


const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
    console.log("Servidor rodando na porta", PORT);
});
