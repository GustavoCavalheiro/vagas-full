<p align="center">
  <img src="icon128.png" width="96" alt="Vagas Full">
</p>

<h1 align="center">Vagas Full</h1>

<p align="center">
  Extensão gratuita para Chrome que monitora e agenda vagas de envio ao <b>Full do Mercado Livre</b> pelo número do envio.
</p>

---

## O que faz

- Consulta a agenda do seu envio ao Full em intervalos regulares (1, 2, 3, 5 ou 10 minutos).
- Filtra por centro de distribuição, período, datas preferidas e faixa de horário.
- **Só aviso:** notificação no computador, som e, se quiser, mensagem no Telegram.
- **Agendamento automático (opcional):** confirma a primeira vaga que atender ao filtro, do mesmo jeito que a tela do Mercado Livre faz.
- Aceita várias formas de envio: veículo particular, coleta, transportadora (com escolha da transportadora) e fornecedor.
- Permite monitorar vários envios ao mesmo tempo.

## Instalação

1. Baixe o arquivo `.zip` da [versão mais recente](https://github.com/GustavoCavalheiro/vagas-full/releases/latest) e descompacte.
2. No Chrome, abra `chrome://extensions`.
3. Ative o **Modo do desenvolvedor**, no canto superior direito.
4. Clique em **Carregar sem compactação** e selecione a pasta descompactada.
5. Fixe o ícone na barra do Chrome.

## Como usar

1. Entre na **Central de Vendedores** do Mercado Livre no Chrome.
2. Abra a página do envio (`…/shipping/inbounds/NÚMERO/hub`), abra a extensão e clique em **Usar aba atual**.
3. Escolha a forma de envio, o período e, se quiser, as datas preferidas e o horário.
4. Ligue **Agendar automaticamente** se quiser que a extensão confirme sozinha. Desligado, ela só avisa.
5. Clique em **Adicionar**.

Pode fechar a janela da extensão. O monitoramento continua em segundo plano enquanto o Chrome estiver aberto.

### Aviso no celular (Telegram)

1. No Telegram, fale com **@BotFather**, envie `/newbot` e copie o token.
2. Mande qualquer mensagem para o seu bot.
3. Abra `https://api.telegram.org/bot<SEU_TOKEN>/getUpdates` e copie o número em `"chat":{"id": …}`.
4. Cole o token e o chat ID em **Ajustes** e toque em **Testar**.

## Como funciona

As consultas são feitas a partir de uma aba da Central de Vendedores, usando o **seu próprio login**. A extensão chama os mesmos endereços que a tela de agendamento do Mercado Livre:

| Etapa | Endereço |
|---|---|
| Vagas disponíveis | `GET /api/shipping/inbounds/{envio}/appointment-v2/schedule-availability` |
| Transportadoras | `GET …/carriers` |
| Confirmação | `POST /api/shipping/inbounds/{envio}/appointment-v2/confirm` |

| Forma de envio | Código |
|---|---|
| Veículo particular | `ftl` |
| Coleta | `pickup` |
| Transportadora | `ftlp` |
| Fornecedor | `supplier` |

## Privacidade

- Nada é enviado a servidores de terceiros. Os dados ficam no `chrome.storage` do seu navegador.
- A extensão só se comunica com `vendedores.mercadolivre.com.br` e, se você configurar, com `api.telegram.org`.
- Nenhuma senha é lida ou armazenada.

## Se algo parar de funcionar

O Mercado Livre pode mudar o sistema a qualquer momento. Abra a extensão, vá em **Registro → Copiar técnico** e abra uma *issue* com o texto. Antes de publicar, apague dados pessoais.

## Avisos

- Projeto independente, **sem qualquer vínculo com o Mercado Livre**.
- Os Termos do Mercado Livre restringem o uso de ferramentas automatizadas. Use por sua conta e risco.
- Prefira intervalos de **5 minutos ou mais**, monitore só os envios que precisam e pause depois de agendar.
- O agendamento automático confirma de verdade na sua conta. Confira o filtro antes de ligar.

## Licença

[MIT](LICENSE)
