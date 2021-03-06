// Imports
import { SCREEN_WIDTH
       , SCREEN_HEIGHT
       , CHARACTER_HEIGHT
       , CHARACTER_WIDTH
       , TILE_SIZE
       } from './constant.js';
import * as PIXI from 'pixi.js';
import * as Character from './character.js';
import 'pixi-tiledmap';

// Application to draw things
let app = new PIXI.Application({
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    antialias: false,
    resolution: 1,
});

// Websocket from the server
let ws;

// Game state
let state = {
    camera: {},
    scene: {},
    map: {
        width: 0,
        height: 0
    },
    puppets: {},
    main: {},
    controls: [],
}

document.body.appendChild(app.view);

PIXI.loader
    .add("assets/character.png")
    .add("assets/m1.tmx")
    .add("assets/m2.tmx")
    .load(setup);

function setup() {
    // init websocket listening
    ws = new WebSocket("ws://localhost:4000");
    ws.onmessage = listen_ws

    // setup the keyboard
    manage_direction(37, "LEFT");
    manage_direction(38, "UP");
    manage_direction(39, "RIGHT");
    manage_direction(40, "DOWN");

    // camera container
    state.camera = new PIXI.Container();
    app.stage.addChild(state.camera);
    state.camera.visible = true;

    // init game loop
    app.ticker.add(delta => game_loop(delta))
}

function game_loop(delta) {
    // reorder children so that upper entities appear behind lower ones
    if('layers' in state.scene) {
        state.scene.layers["objects"].children.sort((a, b) => {
            var y1 = a.y;
            var y2 = b.y;

            if (y1 < y2) {
                return -1;
            } else if (y1 == y2) {
                return 0;
            } else {
                return 1;
            }
        });
    }
}

function listen_ws(event) {
    let data = JSON.parse(event.data);
    let opcode = data["opcode"];
    let message = data["message"];

    switch(opcode) {
    case "ATTRIBUTE_PUPPET":
        // we know who we are going to play
        state.main = message.puppet_key;
        break;
    case "INSTANCE_DIGEST":
        // we have joined a new instance, first let us remove all previous puppets
        for (var pk in state.puppets) {
            remove_puppet(pk);
        }

        // then display the map
        let map_tmx = "assets/" + message.map.map_key + ".tmx";
        state.camera.removeChild(state.scene);
        state.scene = new PIXI.extras.TiledMap(map_tmx);
        state.camera.addChild(state.scene);

        state.map.width = message.map.digest.width * TILE_SIZE;
        state.map.height = message.map.digest.height * TILE_SIZE;

        // then display the puppets already inside
        for (var pk in message.puppets) {
            add_new_puppet(pk, message.puppets[pk]);
        }

        // we can display our scene now
        state.camera.visible = true;
        break;
    case "PUPPET_STARTS":
        state.puppets[message.puppet_key].isMoving = true;
        state.puppets[message.puppet_key].gotoAndPlay(0);
        break;
    case "PUPPET_STOPS":
        state.puppets[message.puppet_key].isMoving = false;
        state.puppets[message.puppet_key].gotoAndStop(0);
        break;
    case "PUPPET_ENTERS":
        add_new_puppet(message.puppet_key, message.digest);
        break;
    case "PUPPET_LEAVES":
        remove_puppet(message.puppet_key, message.digest);
        break;
    case "PUPPET_MOVES":
        var pk = message.puppet_key;

        place_puppet(pk, message.position.x, message.position.y);

        if (pk == state.main) {
            center_camera();
        }
        break;
    case "PUPPET_DIRECTION":
        state.puppets[message.puppet_key].textures =
            Character.get_textures_for(
                "assets/character.png",
                message.direction,
                "walk"
            );

        if(state.puppets[message.puppet_key].isMoving) {
            state.puppets[message.puppet_key].gotoAndPlay(0);
        }
        break;
    }
}

function remove_puppet(pk) {
    state.scene.layers["objects"].removeChild(state.puppets[pk]);
    delete state.puppets[pk];
}

function add_new_puppet(pk, digest) {
    let textures = Character.get_textures_for("assets/character.png", "down", "walk");

    state.puppets[pk] = new PIXI.extras.AnimatedSprite(textures);

    state.puppets[pk].isMoving = false;
    state.puppets[pk].animationSpeed = 0.08;
    state.puppets[pk].width = CHARACTER_WIDTH;
    state.puppets[pk].height = CHARACTER_HEIGHT;
    place_puppet(pk, digest.x, digest.y);

    state.scene.layers["objects"].addChild(state.puppets[pk]);

    if (pk == state.main) {
        center_camera();
    }
}

function center_camera() {
    let pk = state.main;

    let x = (SCREEN_WIDTH / 2) - state.puppets[pk].x;
    let y = (SCREEN_HEIGHT / 2) - state.puppets[pk].y;

    state.camera.position.x = x;
    state.camera.position.y = y;
}

function keyboard(keyCode) {
  let key = {};
  key.code = keyCode;
  key.isDown = false;
  key.isUp = true;
  key.press = undefined;
  key.release = undefined;
  //The `downHandler`
  key.downHandler = event => {
    if (event.keyCode === key.code) {
      if (key.isUp && key.press) key.press();
      key.isDown = true;
      key.isUp = false;
    }
    event.preventDefault();
  };

  //The `upHandler`
  key.upHandler = event => {
    if (event.keyCode === key.code) {
      if (key.isDown && key.release) key.release();
      key.isDown = false;
      key.isUp = true;
    }
    event.preventDefault();
  };

  //Attach event listeners
  window.addEventListener(
    "keydown", key.downHandler.bind(key), false
  );
  window.addEventListener(
    "keyup", key.upHandler.bind(key), false
  );
  return key;
}

function manage_direction(code, string) {
    let handler = keyboard(code);

    handler.press = () => {
        state.controls.push(string);
        ws.send(string);

        if (state.controls.length == 1) {
            ws.send("MOVE");
        }
    };

    handler.release = () => {
        state.controls = state.controls.filter(x => { return x != string })

        if (state.controls.length == 0) {
            ws.send("STOP");
        } else {
            ws.send(state.controls[state.controls.length - 1])
        }
    }
}

function place_puppet(pk, x, y) {
    let map_h = state.map.height;
    let puppet_h = state.puppets[pk].height;

    state.puppets[pk].x = x;
    state.puppets[pk].y = map_h - y - puppet_h;
}
