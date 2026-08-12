let selectedMethod = 'pix';
let statusInterval = null;

const formRegistro = document.getElementById('registration-form');
const idadeInput = document.getElementById('idade');
const respInput = document.getElementById('nome_do_responsavel');
const cpfRespInput = document.getElementById('cpf_do_responsavel');
const btnSubmitPayment = document.getElementById('btn-submit-payment');
const btnCopyPix = document.getElementById('btn-copy-pix');
const containerResponsavel = document.getElementById('container-responsavel');

document.addEventListener('DOMContentLoaded', () => {
    applyCpfMask(document.getElementById('cpf_do_piloto'));
    applyCpfMask(document.getElementById('cpf_do_responsavel'));

    idadeInput.addEventListener('input', verificarIdadeObrigatoriedade);

    formRegistro.addEventListener('submit', (e) => {
        e.preventDefault();
        processPayment();
    });

    btnCopyPix.addEventListener('click', copyPixCode);

    document.getElementById('opt-pix').addEventListener('click', () => selectPayment('pix'));
    document.getElementById('opt-card').addEventListener('click', () => selectPayment('card'));
    document.getElementById('opt-ticket').addEventListener('click', () => selectPayment('ticket'));
});

function applyCpfMask(input) {
    input.addEventListener('input', function (e) {
        let value = e.target.value.replace(/\D/g, '');
        if (value.length > 11) value = value.slice(0, 11);
        if (value.length > 9) {
            value = value.replace(/^(\d{3})(\d{3})(\d{3})(\d{1,2})$/, '$1.$2.$3-$4');
        } else if (value.length > 6) {
            value = value.replace(/^(\d{3})(\d{3})(\d{1,3})$/, '$1.$2.$3');
        } else if (value.length > 3) {
            value = value.replace(/^(\d{3})(\d{1,3})$/, '$1.$2');
        }
        e.target.value = value;
    });
}

function verificarIdadeObrigatoriedade() {
    const idade = parseInt(idadeInput.value, 10);

    if (!idade || idade >= 18) {

        containerResponsavel.style.display = 'none';
        respInput.removeAttribute('required');
        cpfRespInput.removeAttribute('required');
        respInput.value = '';
        cpfRespInput.value = '';

    } else {
        containerResponsavel.style.display = 'block';

        respInput.setAttribute('required', 'required');
        respInput.placeholder = "Digite o nome do responsável (Obrigatório)";

        cpfRespInput.setAttribute('required', 'required');
        cpfRespInput.placeholder = "000.000.000-00 (Obrigatório)";
    }
}

function copyPixCode() {
    const pixCode = document.getElementById('pix-copia-cola').innerText;
    navigator.clipboard.writeText(pixCode).then(() => {
        alert('Código Pix copiado para a área de transferência!');
    }).catch(err => {
        console.error('Erro ao copiar o código Pix: ', err);
    });
}

async function processPayment() {

    const idade = parseInt(idadeInput.value) || 0;
    if (idade < 18) {
        const responsavel = respInput.value.trim();
        const cpfResp = cpfRespInput.value.trim();
        if (!responsavel || cpfResp.length < 14) {
            alert("Para menores de 18 anos, os dados do responsável são obrigatórios!");
            return;
        }
    }

    btnSubmitPayment.disabled = true;
    btnSubmitPayment.innerText = "Gerando Pix...";
    document.getElementById('pix-loading').style.display = 'block';

    const payload = {
        name_do_piloto: document.getElementById('name_do_piloto').value,
        cpf_do_piloto: document.getElementById('cpf_do_piloto').value.replace(/\D/g, ''),
        email: document.getElementById('email').value,
        telefone: document.getElementById('telefone').value,
        numero_da_cba: document.getElementById('numero_da_cba').value,
        idade: idadeInput.value,
        nome_do_responsavel: respInput.value,
        cpf_do_responsavel: cpfRespInput.value.replace(/\D/g, ''),
        numero_do_piloto: document.getElementById('numero_do_piloto').value,
        categoria: document.getElementById('categoria').value,
        tamanho_Camisa: document.getElementById('tamanho_Camisa').value,
        payment_method: selectedMethod
    };

    try {
        const response = await fetch('/api/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok || !data.sucesso) {
            throw new Error(data.message || 'Erro no processamento do Pix.');
        }

        const qrBase64 = data.brCodeBase64;

        const srcFormatado = qrBase64.startsWith('data:image')
            ? qrBase64
            : `data:image/png;base64,${qrBase64}`;

        document.getElementById('pix-loading').style.display = 'none';
        document.getElementById('pix-qr-image').src = srcFormatado;
        document.getElementById('pix-qr-image').style.display = 'block';
        document.getElementById('pix-copia-cola').innerText = data.brCode;
        document.getElementById('pix-copia-cola').style.display = 'block';
        document.getElementById('btn-copy-pix').style.display = 'inline-block';
        btnSubmitPayment.innerText = "Aguardando Pagamento...";

        const pixContainer = document.getElementById('pix-details');
        let avisoAguardando = document.getElementById('aviso-aguardando-pagamento');

        if (!avisoAguardando) {
            avisoAguardando = document.createElement('div');
            avisoAguardando.id = 'aviso-aguardando-pagamento';
            avisoAguardando.style.cssText = `
            margin-top: 15px;
                padding: 12px;
                background-color: #FEF3C7;
                border: 1px solid #F59E0B;
                border-radius: 8px;
                color: #92400E;
                font-size: 0.9rem;
                font-weight: 600;
                text-align: center;
            `;
            avisoAguardando.innerHTML = `<strong> Aguardando confirmação do pagamento via Pix...</strong>`;
            pixContainer.appendChild(avisoAguardando);
        }

        iniciarVerificacaoPagamento(data.pixId);

    } catch (err) {
        console.error(err);
        document.getElementById('pix-loading').style.display = 'none';
        btnSubmitPayment.disabled = false;
        btnSubmitPayment.innerText = "Gerar Pix";
    }
}

function iniciarVerificacaoPagamento(pixId) {
    if (statusInterval) clearInterval(statusInterval);
    statusInterval = setInterval(async () => {
        try {
            const res = await fetch(`/api/check-status/${pixId}`);
            const data = await res.json();
            if (data.status === 'PAID') {
                clearInterval(statusInterval);
                exibirSucessoPagamento(pixId);
            }
        } catch (err) {
            console.error('Erro ao verificar status do pagamento:', err);
        }
    }, 3000);
}

function exibirSucessoPagamento(pixId) {
    document.getElementById('pix-qr-image').style.display = 'none';
    document.getElementById('pix-copia-cola').style.display = 'none';
    document.getElementById('btn-copy-pix').style.display = 'none';

    const pixContainer = document.getElementById('pix-details');
    pixContainer.innerHTML = `
        <div style="text-align: center; padding: 25px 15px; background: #F0FDF4; border: 1px solid #10B981; border-radius: 12px; margin-top: 15px;">
            <div style="font-size: 3.5rem; color: #10B981; line-height: 1;">✓</div>
            <h2 style="color: #065F46; margin-top: 10px; font-size: 1.5rem;">Pagamento Confirmado!</h2>
            <p style="color: #047857; margin-top: 6px; margin-bottom: 20px; font-size: 0.95rem;">Sua inscrição foi confirmada no sistema.</p>
            
            <a href="/api/download-comprovante/${pixId}" target="_blank" id="btn-download-pdf" style="
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                background-color: #10B981;
                color: #FFFFFF;
                padding: 14px 28px;
                text-decoration: none;
                font-size: 1rem;
                border-radius: 8px;
                font-weight: 700;
                box-shadow: 0 4px 12px rgba(16, 185, 129, 0.35);
                transition: all 0.2s ease-in-out;
            " onmouseover="this.style.backgroundColor='#059669'; this.style.transform='translateY(-2px)';" onmouseout="this.style.backgroundColor='#10B981'; this.style.transform='translateY(0)';">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Baixar Comprovante de Inscrição (PDF)
            </a>
        </div>
    `;
    btnSubmitPayment.innerText = "Inscrição Concluída";
    btnSubmitPayment.style.backgroundColor = "#10B981";
}


async function checarStatusPagamento(pixId) {
    const response = await fetch(`/api/check-status/${pixId}`);
    const data = await response.json();

    if (data.status === 'PAID') {
        document.getElementById('area-pix').style.display = 'none';

        const containerSucesso = document.getElementById('area-sucesso');
        containerSucesso.innerHTML = `
            <div style="text-align: center; padding: 20px;">
                <h2 style="color: #28a745;">Pagamento Confirmado! 🎉</h2>
                <p>Sua inscrição foi realizada e confirmada com sucesso.</p>
                <br>
                <a href="/api/download-comprovante/${pixId}" target="_blank" class="btn-download" style="
                    background-color: #28a745;
                    color: white;
                    padding: 12px 24px;
                    text-decoration: none;
                    font-size: 16px;
                    border-radius: 5px;
                    display: inline-block;
                    font-weight: bold;
                ">
                    📄 Baixar Comprovante de Inscrição (PDF)
                </a>
            </div>
        `;
        containerSucesso.style.display = 'block';

        clearInterval(intervaloCheck);
    }
}
