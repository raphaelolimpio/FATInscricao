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
    enviarArquivo,
    buscarBanner,
    buscarRegulamento,
    baixarArquivo
} = require('./googleDrive');

const app = express();
app.use(express.json());
app.use(cors());

app.use(express.static(__dirname));

app.get("/", (req, res) => {
    console.log("Recebi GET /");
    res.status(200).send("Servidor funcionando!");
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
        const workbook = new ExcelJS.Workbook();
        let worksheet;

        if (fs.existsSync(NOME_ARQUIVO_EXCEL)) {
            await workbook.xlsx.readFile(NOME_ARQUIVO_EXCEL);
            worksheet = workbook.getWorksheet('Inscrições');
        } else {
            worksheet = workbook.addWorksheet('Inscrições');

            worksheet.columns = [
                { header: 'Data/Hora', key: 'dataHora', width: 22 },
                { header: 'Nome do Piloto', key: 'nome', width: 25 },
                { header: 'CPF Piloto', key: 'cpf', width: 16 },
                { header: 'E-mail', key: 'email', width: 25 },
                { header: 'Telefone', key: 'telefone', width: 16 },
                { header: 'Nº CBA', key: 'cba', width: 18 },
                { header: 'Idade', key: 'idade', width: 10 },
                { header: 'Nome Responsável', key: 'nomeResp', width: 25 },
                { header: 'CPF Responsável', key: 'cpfResp', width: 16 },
                { header: 'Nº Piloto', key: 'numPiloto', width: 12 },
                { header: 'Categoria', key: 'categoria', width: 15 },
                { header: 'Valor (R$)', key: 'valor', width: 12 },
                { header: 'ID Pix', key: 'idPix', width: 32 },
                { header: 'Status Pagamento', key: 'status', width: 18 },
                { header: 'Data/Hora Pagamento', key: 'dataPagamento', width: 22 }
            ];

            worksheet.getRow(1).font = { bold: true };
        }
        worksheet.addRow({
            dataHora: new Date().toLocaleString('pt-BR'),
            nome: dadosPiloto.name_do_piloto || '',
            cpf: dadosPiloto.cpf_do_piloto || '',
            email: dadosPiloto.email || '',
            telefone: dadosPiloto.telefone || '',
            cba: dadosPiloto.numero_da_cba || '',
            idade: dadosPiloto.idade || '',
            nomeResp: dadosPiloto.nome_do_responsavel || 'N/A',
            cpfResp: dadosPiloto.cpf_do_responsavel || 'N/A',
            numPiloto: dadosPiloto.numero_do_piloto || '',
            categoria: dadosPiloto.categoria || '',
            valor: (dadosPiloto.amount / 100),
            idPix: pixData.id || '',
            status: pixData.status || 'Pendente',
            dataPagamento: ''
        });

        await workbook.xlsx.writeFile(NOME_ARQUIVO_EXCEL);
        await enviarArquivo(NOME_ARQUIVO_EXCEL,
            "inscricoes_pilotos.xlsx");
        console.log(`Incrição do piloto ${dadosPiloto.name_do_piloto} salva na planilha com sucesso!`);
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

    await baixarArquivo(banner.id,res);
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
        let valorPix;

        if (dados.categoria === "M" || dados.categoria === "C") {
            valorPix = 10000;
        } else {
            valorPix = 15000;
        }

        dados.amount = valorPix;

        const clienteResponse = await axios.post(
            "https://api.abacatepay.com/v1/customer/create",
            {
                name: dados.name_do_piloto,
                email: dados.email,
                cellphone: dados.telefone,
                taxId: dados.cpf_do_piloto,
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

        console.log(`Status do Pix ${pixId}:`, status);

        if (status === 'PAID') {
            await atualizarStatusPlanilha(pixId, 'Pago');

            const pdf = await gerarComprovante(dadosPiloto, {
                id: pixId,
            });
            await enviarComprovanteEmail(dadosPiloto, pdf);
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


async function atualizarStatusPlanilha(pixId, novoStatus) {
    try {
        if (!fs.existsSync(NOME_ARQUIVO_EXCEL)) return;

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(NOME_ARQUIVO_EXCEL);
        const worksheet = workbook.getWorksheet('Inscrições');

        let alterado = false;
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;

            if (row.getCell(13).value === pixId && row.getCell(14).value !== novoStatus) {
                row.getCell(14).value = novoStatus;
                row.getCell(15).value = new Date().toLocaleString('pt-BR');
                alterado = true;
            }
        });

        if (alterado) {
            await workbook.xlsx.writeFile(NOME_ARQUIVO_EXCEL);
            console.log(`Status do pagamento para Pix ID ${pixId} atualizado para "${novoStatus}" na planilha.`);
        }
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
    if (!fs.existsSync(NOME_ARQUIVO_EXCEL)) return null;

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(NOME_ARQUIVO_EXCEL);
    const worksheet = workbook.getWorksheet('Inscrições');

    let piloto = null;

    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;

        if (row.getCell(13).value === pixId) {
            piloto = {
                name_do_piloto: row.getCell(2).value,
                cpf_do_piloto: row.getCell(3).value,
                email: row.getCell(4).value,
                telefone: row.getCell(5).value,
                numero_da_cba: row.getCell(6).value,
                idade: row.getCell(7).value,
                nome_do_responsavel: row.getCell(8).value,
                cpf_do_responsavel: row.getCell(9).value,
                numero_do_piloto: row.getCell(10).value,
                categoria: row.getCell(11).value,
                amount: row.getCell(12).value * 100,
            };
        }
    });
    return piloto;
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
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
