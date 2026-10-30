# CabineVR

Esquadrilha: combate aéreo arcade em VR para o Meta Quest 3 no navegador (WebXR), sem instalar nada.
Você fica sentado dentro da cabine de um caça e pilota com controles físicos: agarra o manche com a mão
direita e a manete com a esquerda. Metralhadora no gatilho direito; mísseis travam pelo olhar (o inimigo
que fica ~1 s no anel do meio da visão fica travado) e saem no gatilho esquerdo. 3 setores com 4 missões
cada (a 4ª é chefe): Cânion, Mar de Nuvens e Frota. Objetivos variados (abater, corrida de portais,
escolta, proteger, destruir em tempo, chefes com pontos fracos) e 1 a 3 estrelas. Também joga no PC com
mouse e teclado. Tudo em português.

## Como rodar / jogar

**No Quest:** depois de publicado, abrir no navegador do óculos **https://parappathe.github.io/CabineVR/**
e apertar "Entrar em VR". Para publicar/atualizar: commitar e rodar `python publicar.py CabineVR` na
pasta `C:\claude code` (só quando o Eduardo pedir).

**No PC:** `python serve.py` nesta pasta e abrir `http://localhost:8831` (o painel de visualização usa
`.claude/launch.json`). O `serve.py` manda o navegador não guardar cache; `python serve.py --https`
serve para abrir no Quest pela rede de casa (porta 8443).

### Controles

| | VR (Quest) | PC |
|---|---|---|
| Manche | Segurar o aperto (botão lateral) direito: o manche fica onde a mão pegou. Mão para a frente = nariz desce, para trás = sobe, para os lados = inclina e faz a curva (guinada automática) | Mouse (clique para travar o mouse; sem trava vale a posição do mouse na tela). Setas ou A/D também |
| Soltar o manche | Soltar o aperto: o avião se nivela sozinho devagar | Mouse de volta ao meio (ou soltar as setas) |
| Manete | Segurar o aperto esquerdo: empurrar = acelera, puxar = freia | W/S ou roda do mouse |
| Turbo curto | X ou A (ou apertar a alavanca) | Espaço |
| Metralhadora | Gatilho direito | Clique esquerdo |
| Míssil | Olhar para o inimigo ~1 s até travar (anel vermelho, tom contínuo) e gatilho esquerdo | Deixar o inimigo no anel do meio da tela ~1 s e clique direito |
| Reserva sem agarrar | Alavanca direita = manche, alavanca esquerda = manete | |
| Só com as mãos | Pinça direita segura o manche, pinça esquerda a manete; a metralhadora atira sozinha com a mira em cima e o míssil sai sozinho quando trava | |
| Câmera | | C: cabine ou atrás do avião |
| Pausa | B ou Y | Esc ou P |
| Recomeçar | Pausa → Recomeçar a missão | R |
| Menu | Apontar com o controle e gatilho | Clique (Enter decola no briefing) |
| FPS | Menu → FPS | Tecla F |

Na pausa do VR: "Recentralizar" põe os olhos no assento olhando para o nariz e acerta a altura medindo a
cabeça (sentado ou em pé); "Mais baixo / Mais alto" ajustam de 5 em 5 cm (fica salvo). Conforto: vinheta
nas curvas fortes (opção "Vinheta") e "Horizonte: firme" (a visão inclina só metade da rolagem); a armação
do canopi, o painel, o nariz e as asas ficam sempre à vista. O controle vibra nos tiros, ao travar, ao
levar tiro e ao bater.

### Regras

Escudo de 100 que recarrega 5 por segundo depois de 3 s sem levar dano; zerou = abatido. Metralhadora
12 tiros/s. Mísseis: 6, volta 1 a cada 6 s; míssil travado persegue, sem trava vai reto. Nuvem entre
você e o inimigo não deixa travar. No cânion, bater no paredão tira escudo e voar acima da borda leva
tiro da antiaérea; no céu aberto, sair da área da missão também machuca. Estrelas: 1 por vencer, +1 pelo
tempo (nas missões de proteger, pela vida que sobrou no aliado), +1 por levar pouco dano. Limites em
`stars` de cada missão. Progresso salvo no navegador (localStorage `cabinevr.v1`). Vencer libera a
próxima missão.

Missões (em `js/missions.js`):
- Cânion: 1 Primeiro voo (alvos no chão, 6 de 8), 2 Corrida do Cânion (16 portais, portal perdido +5 s),
  3 Comboio (escoltar o avião de carga; caças passam rasantes e voltam por cima), 4 Fortaleza do Cânion
  (chefe: 4 canhões abrem o escudo do reator, na bacia redonda do fim).
- Mar de Nuvens: 5 Caçada nas Nuvens (6 caças), 6 Dirigíveis (5 em até 150 s), 7 Cargueiro (proteger
  por 110 s), 8 Ás Vermelho (chefe: rápido, quebra curvas, solta chamariz que desvia míssil).
- Frota: 9 Fragata (4 pontos fracos), 10 Ataque à Frota (2 fragatas em até 170 s), 11 Porta-aviões
  (proteger de bombardeiros por 120 s), 12 Encouraçado Celeste (chefe: 4 geradores abrem o núcleo).

## Como testar

- `node tests/run.js` (ou `npm test`): voo (puxar sobe, inclinar faz curva, guinada automática, limites
  de inclinação e arfagem, nivelar sozinho ao soltar, manete, turbo com recarga, subir perde velocidade,
  manche automático), cenários (cânion fechado nas pontas, largura mínima, bacia do chefe, nuvens tapam a
  visão), colisão (paredão, chão, casco das naves, teto, antiaérea), armas (metralhadora acerta só o que
  está na mira, cadência, trava de 1 s pelo olhar, nuvem bloqueia a trava, míssil persegue, munição
  recarrega, núcleo com escudo), escudo e inimigos (recarga, caças perseguem e atiram, quebram a curva,
  torres de alcance limitado, bombardeiro acerta o porta-aviões, caças do cânion passam e voltam),
  objetivos e estrelas, validação das 12 missões e o **robô**: joga cada missão com 3 sementes usando só
  os comandos do jogador (manche dentro do curso, manete, gatilhos, olhar limitado ao que a cabeça vira)
  e tem que vencer todas. Imprime tempo, dano e estrelas do robô. Termina com "Tudo certo". Não toca som.
- No navegador (console): `dev.loadLevel(3)` abre a missão 3 já voando, `dev.autoplay = true` faz o robô
  pilotar, `dev.advance(20)` avança 20 s na hora, `dev.state()` mostra tela, missão, objetivo, escudo,
  dano e posição, `dev.snapshot()` devolve a imagem da tela (JPEG em data URL), `dev.resetSave()` apaga o
  progresso, `dev.screen('levels')` mostra uma tela do menu e `dev.camera('chase')` troca a câmera.
  `window.esquadrilha` tem `mission`, `save`, `sfx`, `startLevel`, `goMenu`.
- **Só dá para testar no óculos:** sensação do manche e da manete agarrados, sensibilidade (9 cm de mão =
  manche todo; 20 cm = manete toda), trava pelo olhar com a cabeça, recentralizar e altura, conforto
  (vinheta, horizonte firme), vibração, pinça, FPS no Quest 3.

## Estrutura

| Arquivo | O que tem |
|---|---|
| `index.html`, `css/style.css` | Página, botão "Entrar em VR", HUD e avisos do PC |
| `js/flight.js` | Voo arcade: rumo, arfagem e rolagem com limites, manche/manete/turbo, nivelar sozinho, `steerTo` (manche automático do robô). Sem navegador |
| `js/env.js` | Cenários: cânion sinuoso (paredes, borda, bacia do chefe), mar de nuvens (nuvens que tapam a visão), mar aberto. Sem navegador |
| `js/mission.js` | `Mission`: caça do jogador, inimigos (IA de caças, ás, bombardeiros, torres, naves com pontos fracos e núcleo com escudo), aliados, tiros, mísseis, trava pelo olhar, escudo, ondas, objetivos, estrelas, eventos. Sem navegador |
| `js/missions.js` | As 12 missões (legenda no topo do arquivo). Sem navegador |
| `js/robot.js` | Robô piloto (testes e `dev.autoplay`). Sem navegador |
| `js/main.js` | Liga tudo: render, VR (manche e manete agarrados, gatilhos, botões, vibração, recentralizar), mouse/teclado, câmeras, menus, HUD e instrumentos, sons, `dev` |
| `js/scene.js` | Céu, cânion, nuvens, mar, modelos (montados de peças mescladas), cabine, traçantes, partículas, marcadores |
| `js/ui.js` | Painel de menu 3D em canvas e placas de texto |
| `js/audio.js` | Sons sintetizados (turbina, vento, tiros, míssil, explosões, bipes da trava, alarmes, jingles) |
| `js/save.js` | Progresso e opções salvos |
| `tests/run.js` | Testes |
| `serve.py` | Servidor local sem cache (porta 8831, `--https` para o Quest) |
| `vendor/three/three.module.js` | Three.js r170 (cópia local) |

Coordenadas: metros, y para cima. Rumo `psi` = 0 olha para -z, positivo vira para a esquerda; `phi`
positivo = asa direita para baixo. No cânion, `s = -z` é a distância desde a entrada e a parede fica em
`x = cx(s) ± (hw(s) + 0,19·y)`. Peças das naves (`parts`) ficam em coordenadas locais da nave (x direita,
y cima, z para trás). O olho do piloto fica em (0; 0,95; -2,4) no avião.

## Regras e convenções do projeto

- `flight.js`, `env.js`, `mission.js`, `missions.js` e `robot.js` não podem usar navegador nem Three.js:
  os testes rodam no Node.
- `scene.js` desenha com as mesmas medidas da lógica (paredão em degraus seguindo a inclinação de
  `WALL_SLOPE`, cascos das naves com os mesmos raios de `hull`).
- Missão nova ou mudada: seguir a legenda de `missions.js`, rodar `node tests/run.js` e acertar `stars`
  pelos números do robô, com folga.
- Mexeu em voo, inimigos, armas, missões ou robô: rodar `node tests/run.js`.
- Tudo que o jogador lê em português do Brasil.

## Decisões

- Voo arcade próprio (sem biblioteca), passo fixo de 1/60 s, atitude em três ângulos com limites
  (inclinação até 75°, arfagem até 69°): o avião nunca fica de ponta-cabeça (conforto no VR). Inclinado
  o nariz cai um pouco; com o manche todo puxado na inclinação máxima a curva fica nivelada.
- Manche e manete "vêm até a mão": o neutro é onde a mão agarrou, então não precisa achar a peça no
  escuro. Manche solto nivela sozinho devagar.
- Trava do míssil pela cabeça (cone de 6°, 1 s); no PC é o centro da tela. A trava se mantém até 16° e
  cai depois de 0,6 s fora.
- Inimigos atiram com dispersão e o escudo recarrega, para ser jogável por iniciante; canhões montados
  em nave só cobrem o lado deles. O Ás solta chamariz (desvia mísseis) e tem blindagem contra míssil.
- Estrelas calibradas pelo robô (3 sementes nos testes): os limites ficam acima dos números dele, então
  o robô quase sempre tira 3 estrelas; uma pessoa deve precisar treinar para isso.
- Estilo de pôster de aviação antigo: low poly facetado, cores chapadas quentes, céu em faixas,
  menus em papel creme com tinta azul-marinho e vermelho-coral.
- Desempenho de Quest: pixelRatio 1, foveação, geometria mesclada por modelo, nuvens/arbustos/mesas/
  tiros/partículas/marcadores instanciados, 2 luzes sem sombra, sem pós-processamento, HUD e
  instrumentos redesenhados só 20 e 10 vezes por segundo.
- Porta do servidor local 8831.

## Pendências / problemas conhecidos

- **Nada foi testado no Quest ainda**: manche e manete agarrados, sensibilidade, trava pelo olhar,
  recentralizar e altura, conforto (vinheta, horizonte firme), vibração, pinça, FPS no óculos.
- Os limites das estrelas e a dificuldade foram calibrados pelo robô; podem precisar de ajuste depois
  de jogar (a Fortaleza e o Encouraçado são as mais difíceis).
- No PC o mouse só vira manche de verdade com o mouse travado (clique na tela); sem trava ele usa a
  posição do cursor.
- Sons só foram checados por não dar erro; ninguém ouviu ainda.
- Ainda não publicado e sem cartão no `SiteJogos`.
