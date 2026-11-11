# 🎮 MoviKids — Kinect com a câmera do celular + jogos na TV

Site infantil que reconhece **até duas pessoas** pela câmera do celular e usa os movimentos para jogar pela TV. Não exige cadastro nem câmera na televisão.

## O que já vem pronto

- **TV:** código temporário de seis dígitos, QR Code, pontuação, cronômetro, escolha da brincadeira, pausa, reinício e tela cheia.
- **Celular:** pareamento com a TV, permissão de câmera, seleção entre câmera frontal/traseira, reconhecimento de **até dois corpos** com MediaPipe Pose Landmarker e exibição do esqueleto em cima da imagem.
- **Jogo 1: Bolhas Mágicas:** estoure bolhas com os braços/mãos.
- **Jogo 2: Caça-Estrelas:** alcance estrelas que descem na tela; as especiais dão bônus.
- **Jogo 3: Dança das Poses:** levante braços, abra braços, aproxime mãos da cabeça e abaixe os braços para ganhar pontos.
- **Em dupla:** duas crianças lado a lado, cada uma na sua metade do jogo. Pode mudar para modo de uma criança.
- **Privacidade:** a imagem da câmera é analisada diretamente no telefone. Apenas coordenadas de articulações e resultados dos gestos são compartilhados via WebSocket com a TV. Não há banco de dados nem gravação de imagem, voz ou nome.

## Como usar depois de publicar

1. Na TV: acesse `https://SEU-SITE.onrender.com/tv` pelo navegador da Smart TV. Anote o código que aparece na tela.
2. No celular: acesse `https://SEU-SITE.onrender.com/celular` ou escaneie o QR Code da TV.
3. Digite o código (ou use o link do QR), toque **Ativar câmera** e **Permitir** no aviso do celular.
4. Apoie o celular **na horizontal**, com a câmera apontada para as duas crianças. Deixe os corpos inteiros no quadro; crianças preferencialmente **lado a lado**, sem ficar uma na frente da outra.
5. Na TV ou no celular, selecione o jogo e toque em **Começar**.
6. Mova os braços/mãos na sua metade do quadro. A TV verá os esqueletos virtuais (não a imagem real dos participantes).

> Se a Smart TV não tiver leitor de QR, digite o código na página de celular. Ambos os dispositivos precisam de internet, mas não precisam estar na mesma rede Wi-Fi.

## Publicar no Render (recomendado)

1. Crie um repositório no GitHub e envie **os arquivos e as pastas que estão dentro da pasta MoviKids**. O arquivo `package.json` precisa estar na raiz do repositório.
2. No Render, clique **New > Web Service** e conecte o repositório. Não use Static Site: o servidor WebSocket precisa de um serviço Node.js.
3. Configure:

   | Campo do Render | Valor |
   | --- | --- |
   | Runtime | Node |
   | Build Command | `npm install --omit=dev` |
   | Start Command | `npm start` |
   | Instance | Free (se disponível) |

4. Publique. O Render disponibilizará uma URL HTTPS terminada em `.onrender.com`.
5. Abra `/tv` pela TV e `/celular` pelo telefone.

Também inclui `render.yaml` para Blueprint. **Nenhuma variável de ambiente é necessária.** O Render preenche a variável `PORT` automaticamente.

## Rodar no PC

```bash
npm install
npm start
```

Visite `http://localhost:3000/` para a página inicial ou `http://localhost:3000/tv` para jogar na tela do PC. A câmera é liberada em `http://localhost` no próprio aparelho, mas **um celular abrindo pelo IP local via HTTP não consegue usar `getUserMedia` em navegadores modernos**. Use HTTPS em produção.

## Como funciona

```
 Celular (Chrome/Safari)              Render                 Smart TV (navegador)
 ┌─────────────────────┐            ┌─────────────┐         ┌───────────────────┐
 │ Câmera + MediaPipe  │            │ Node.js     │         │ Canvas 2D         │
 │ Pose Landmarker     │            │ Express     │         │ Bolhas / Estrelas │
 │ 2 pessoas / 33 pts  │            │ WebSocket   │         │ Dança das Poses   │
 └────────┬────────────┘            └──────┬──────┘         └─────────┬─────────┘
          └──── dados de postura ──────────┴───────────────────────────┘
                  (SEM vídeo, áudio, imagens ou identificação)
```

Tecnologias: Node.js, Express, `ws`, Canvas 2D, MediaPipe Tasks Vision 0.10.35. A biblioteca JavaScript é servida do pacote instalado; o **modelo de IA é baixado do Google no primeiro uso da câmera**, então a primeira ativação precisa de internet e pode ser mais lenta. O reconhecimento acontece no celular; a TV só recebe as posições e desenha os avatares.

## Dicas de precisão

- Celular com navegador relativamente atual (Chrome para Android, Safari para iPhone). Dispositivos antigos podem demorar ou reconhecer apenas uma pessoa.
- Câmera fixa, de preferência na horizontal, com corpo completo visível, a 2–4 metros de distância, dependendo do campo de visão da lente.
- Boa iluminação, roupas distintas do fundo, distância entre os jogadores e sem móveis/obstáculos nas proximidades.
- Se apenas uma criança for reconhecida, afaste o celular ou ajuste a iluminação. Escolha modo **1 criança** se necessário.
- Se o jogo não carregar, recarregue as páginas da TV/celular, verifique HTTPS, internet e a permissão de câmera.
- O serviço gratuito do Render pode adormecer, causando perda da conexão e exigindo novo pareamento.

## Estrutura

```
MoviKids/
├── server.js               # Salas temporárias + WebSocket + QR Code
├── package.json            # Dependências Node.js
├── render.yaml             # Configuração de publicação Render
└── public/
    ├── index.html          # Apresentação
    ├── tv.html             # Jogo da TV
    ├── celular.html        # Câmera e controle
    ├── styles.css          # Layout infantil e responsivo
    └── js/
        ├── common.js
        ├── game.js          # Motor dos 3 jogos, física e pontuação
        ├── tv.js            # Pareamento e controle na TV
        └── mobile.js        # Reconhecimento e envio de poses
```

## Segurança

Projetado para brincar sob supervisão de um adulto, com um ambiente livre de obstáculos. Não há acesso a localização, microfone, contatos, galeria ou outras câmeras sem permissão. Os códigos são temporários, exclusivos durante a sessão e removidos quando a TV desconecta. O servidor não persiste dados do jogo.

Este projeto é uma solução web inspirada no conceito de controle por gestos do Kinect, **não é o Kinect oficial da Microsoft** e não possui sensor de profundidade. A qualidade do rastreamento depende da câmera, do aparelho e da luz.
