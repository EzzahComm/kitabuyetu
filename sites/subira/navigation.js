const toggle = document.querySelector('.menu-toggle');
const navigation = document.getElementById('primary-navigation');

function setExpanded(expanded) {
  toggle.setAttribute('aria-expanded', String(expanded));
}

toggle.addEventListener('click', () => setExpanded(toggle.getAttribute('aria-expanded') !== 'true'));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
    setExpanded(false);
    toggle.focus();
  }
});
navigation.addEventListener('click', (event) => {
  if (event.target.closest('a')) setExpanded(false);
});
toggle.dataset.ready = '';
