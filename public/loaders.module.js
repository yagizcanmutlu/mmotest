// /public/loaders.module.js
// Sadece loader modüllerini local jsm yolundan içeri alıp window'a asıyoruz.
import { GLTFLoader }  from '/vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from '/vendor/three/examples/jsm/loaders/DRACOLoader.js';

window.GLTFLoader  = GLTFLoader;
window.DRACOLoader = DRACOLoader;
