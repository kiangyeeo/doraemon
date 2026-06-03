import { render } from 'preact';
import { MascotStage } from './components/MascotStage';
import './styles/global.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Renderer root element was not found.');
}

render(<MascotStage manifestUrl="assets/characters/doraemon/manifest.json" />, root);
