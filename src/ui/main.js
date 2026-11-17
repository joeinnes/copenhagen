// Copenhagen: the page. The model lives in ../model (typed, tested); the engine in ./engine.svelte.js; the markup in ./components.
import { mount } from 'svelte';
import App from './components/App.svelte';
import '../styles.css';

mount(App, { target: document.body });
