let selectedMethod = 'pix';
let statusInterval = null;

const formRegistro = document.getElementById('registration-form');
const idadeInput = document.getElementById('idade');
const respInput = document.getElementById('nome_do_responsavel');
const cpfRespInput = document.getElementById('cpf_do_responsavel');

const btnSubmitPayment = document.getElementById('btn-submit-payment');
const btnCopyPix = document.getElementById('btn-copy-pix');

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
    const idade = parseInt(idadeInput.value) || 0;
    if (idade >= 18) {
        respInput.removeAttribute('required');
        respInput.placeholder = "Digite o nome do responsável (Opcional)";
        cpfRespInput.removeAttribute('required');
        cpfRespInput.placeholder = "000.000.000-00 (Opcional)";
    } else {
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
    // Validação extra para menor de idade antes de chamar a API
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
        categoria: document.getElementById('tshirt').value,
        payment_method: selectedMethod
    };

    try {
        const response = await fetch('http://localhost:3000/api/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok || !data.sucesso) {
            throw new Error(data.message || 'Erro no processamento do Pix.');
        }

        document.getElementById('pix-loading').style.display = 'none';
        document.getElementById('pix-qr-image').src = data.brCodeBase64;
        document.getElementById('pix-qr-image').style.display = 'block';
        document.getElementById('pix-copia-cola').innerText = data.brCode;
        document.getElementById('pix-copia-cola').style.display = 'block';
        document.getElementById('btn-copy-pix').style.display = 'inline-block';
        btnSubmitPayment.innerText = "Aguardando Pagamento...";

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
                const res = await fetch(`http://localhost:3000/api/check-status/${pixId}`);
                const data = await res.json();
                if (data.status === 'PAID') {
                    clearInterval(statusInterval);
                    exibirSucessoPagamento();
                }
            } catch (err) {
                console.error('Erro ao verificar status do pagamento:', err);
            }
        }, 3000);
}

function exibirSucessoPagamento() {
    document.getElementById('pix-qr-image').style.display = 'none';
    document.getElementById('pix-copia-cola').style.display = 'none';
    document.getElementById('btn-copy-pix').style.display = 'none';

    const pixContainer = document.getElementById('pix-details');
    pixContainer.innerHTML = `
        <div style="text-align: center; margin-top: 20px;">
            <div style="font-size: 3rem; color: #10B981;">✓</div>
            <h2 style="color: #10B981;; maring-top: 10px;">Pagamento Confirmado!</h2>
            <p style ="color: #4B5563; margin-top: 5px;">Sua inscrição foi realizada com sucesso.</p>
        </div>
    `;
    btnSubmitPayment.innerText = "Incrição Conluida";
    btnSubmitPayment.style.backgroundColor = "#10B981"; 
}