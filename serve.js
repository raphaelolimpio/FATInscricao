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
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

app.get("/api/sincronizar-pagamentos", async (req, res) => {
    try {
        const spreadsheetId = process.env.GOOGLE_DRIVE_FILE_ID;
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: "'Inscrições'!A:Q",
        });

        const rows = response.data.values;
        if (!rows || rows.length <= 1) {
            return res.status(200).json({ message: "Nenhuma linha encontrada na planilha." });
        }

        const atualizados = [];
        const erros = [];

        // Começa em i = 1 para pular o cabeçalho
        for (let i = 1; i < rows.length; i++) {
            const linhaAtual = rows[i];
            
            // Coluna N (Índice 13) = ID Pix, Coluna O (Índice 14) = Status
            const pixId = linhaAtual[13] ? String(linhaAtual[13]).trim() : '';
            const statusAtual = linhaAtual[14] ? String(linhaAtual[14]).trim() : '';
            const emailPiloto = linhaAtual[3] ? String(linhaAtual[3]).trim() : '';
            const nomePiloto = linhaAtual[1] ? String(linhaAtual[1]).trim() : '';

            if (pixId && statusAtual !== "Pago") {
                try {
                    console.log(`[Sincronização] Consultando Pix ${pixId} (${nomePiloto})...`);

                    const checkResp = await axios.get(
                        "https://api.abacatepay.com/v2/transparents/check",
                        {
                            params: { id: pixId },
                            headers: {
                                Authorization: `Bearer ${AUTORIZATION_API_KEY || API_KEY}`,
                                "Content-Type": "application/json"
                            }
                        }
                    );

                    const statusGateway = checkResp.data?.data?.status;

                    if (statusGateway === "PAID" || statusGateway === "COMPLETED") {
                        console.log(`[Sincronização] Pix ${pixId} PAGO! Atualizando planilha...`);

                        await atualizarStatusPlanilha(pixId, "Pago");

                        const dadosPiloto = await getDadosPilotoByPixId(pixId);
                        if (dadosPiloto && dadosPiloto.email) {
                            try {
                                const pdfPath = await gerarComprovante(dadosPiloto, { id: pixId });
                                await enviarComprovanteEmail(dadosPiloto, pdfPath);
                                console.log(`[Sincronização] Comprovante enviado para ${dadosPiloto.email}`);
                            } catch (mailErr) {
                                console.error(`[Sincronização] Erro ao enviar e-mail:`, mailErr.message);
                            }
                        }

                        atualizados.push({
                            nome: nomePiloto,
                            email: emailPiloto,
                            pixId: pixId,
                            statusAnterior: statusAtual,
                            novoStatus: "Pago"
                        });
                    }
                } catch (checkErr) {
                    console.error(`[Sincronização] Erro no Pix ${pixId}:`, checkErr.response?.data || checkErr.message);
                    erros.push({ pixId, erro: checkErr.response?.data || checkErr.message });
                }
            }
        }

        return res.status(200).json({
            sucesso: true,
            totalAtualizados: atualizados.length,
            pilotosAtualizados: atualizados,
            erros: erros
        });

    } catch (err) {
        console.error("Erro geral na sincronização:", err);
        return res.status(500).json({ sucesso: false, erro: err.message });
    }
});

app.post(["/api/webhook/abacatepay", "/api/webhook"], async (req, res) => {
    try {
        const { webhookSecret } = req.query;

        if(webhookSecret != WEBHOOK_SECRET) {
            console.warn("[Webhook] Tentativa de acesso não autorizada. Secret inválida");
            return res.status(401).json({error: "unauthorized: Invalid webhook secret"})
        }
        const body = req.body;
        console.log("[Webhook AbacatePay Recebido]", JSON.stringify(body));

        const pixId = body.data?.id || body.data?.pixId || body.id || body.pixId;
        const status = body.data?.status || body.status;
        const event = body.event;

        if (status === 'PAID' || status === 'COMPLETED' || event === 'billing.paid') {
            console.log(`[Webhook] Pagamento confirmado para o Pix ID: ${pixId}`);

            await atualizarStatusPlanilha(pixId, 'Pago');

            const dadosPiloto = await getDadosPilotoByPixId(pixId);
            if (dadosPiloto && dadosPiloto.email) {
                const pdf = await gerarComprovante(dadosPiloto, { id: pixId });
                await enviarComprovanteEmail(dadosPiloto, pdf);
                console.log(`[Webhook] Comprovante enviado com sucesso para ${dadosPiloto.email}`);
            }
        }
        return res.status(200).json({ received: true });
    } catch (err) {
        console.error('[webhook Erro]:', err);
        return res.status(500).json({ error: 'Erro ao processar webhook' });
    }
});

app.get("/api/download-comprovante/:pixId", async (req, res) => {
    try {
        const { pixId } = req.params;

        const dadosPiloto = await getDadosPilotoByPixId(pixId);

        if (!dadosPiloto) {
            return res.status(404).send("Inscrição/Piloto não encontrado.");
        }

        const caminhoPDF = await gerarComprovante(dadosPiloto, { id: pixId });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Comprovante_Inscricao_${pixId}.pdf"`);

        res.sendFile(caminhoPDF, (err) => {
            if (fs.existsSync(caminhoPDF)) {
                fs.unlinkSync(caminhoPDF);
            }
            if (err) {
                console.error("Erro ao enviar PDF para download:", err);
            }
        });

    } catch (err) {
        console.error("Erro ao gerar comprovante para download:", err);
        return res.status(500).send("Erro ao gerar o comprovante.");
    }
});



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
        console.log(`Status do Pix ${pixId}: `, status);


        if (status === 'PAID' || status === 'COMPLETED') {
            await atualizarStatusPlanilha(pixId, 'Pago');
            const dadosPiloto = await getDadosPilotoByPixId(pixId);
            if (dadosPiloto && dadosPiloto.email) {
                gerarComprovante(dadosPiloto, { id: pixId })
                    .then(pdf => enviarComprovanteEmail(dadosPiloto, pdf))
                    .catch(e => console.error("Erro ao enviar emial na checagem: ", e.message));
            }

        }
        return res.status(200).json({
            sucesso: true,
            status: status
        });
    } catch (err) {
        console.error('Erro ao verificar status de pagamento:', err.response?.data || err.message);
        return res.status(500).json({
            err: 'Erro ao verificar status do pagamento',
        });
    }
});

async function contarInscritosPagosCCategoria(categoria) {
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

async function atualizarStatusPlanilha(pixId, novoStatus) {
    try {
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
            size: [595, 420],
            margin: 30
        });

        const stream = fs.createWriteStream(caminho);
        doc.pipe(stream);

        const caminhoLogo = path.join(__dirname, 'logo.png');
        if (fs.existsSync(caminhoLogo)) {
            doc.save();
            doc.opacity(0.12);
            doc.image(caminhoLogo, (595 - 320) / 2, (420 - 180) / 2, { width: 320 });
            doc.restore();
        }

        doc.fillColor('#000000')
            .fontSize(18)
            .font('Helvetica-Bold')
            .text('Comprovante de Inscrição', { align: 'center' });
        doc.moveDown(1.2);

        doc.font('Helvetica').fontSize(11);

        const dataApenas = new Date().toLocaleDateString('pt-BR');
        const valorFormatado = (dadosPiloto.amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });


        doc.text(`Nome do Piloto: ${dadosPiloto.name_do_piloto}`);
        doc.text(`CPF do Piloto: ${dadosPiloto.cpf_do_piloto}`);
        doc.text(`Categoria: ${dadosPiloto.categoria}`);
        doc.text(`Tamanho da camisa: ${dadosPiloto.tamanho_Camisa}`);
        doc.text(`E-mail: ${dadosPiloto.email}`);
        doc.text(`Telefone: ${dadosPiloto.telefone}`);

        doc.moveDown(0.8);

        doc.font('Helvetica-Bold');
        doc.text(`Valor Pago: ${valorFormatado}`);
        doc.text(`Status: PAGO`);
        doc.text(`Data do Pagamento: ${dataApenas}`);

        doc.moveDown(1.5);

        doc.font('Helvetica')
            .fontSize(13)
            .fillColor('#10B981')
            .text('Obrigado por se inscrever! Boa sorte na competição!', { align: 'center' });
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

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: "Inscrições!A:P",
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) return null;

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
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
