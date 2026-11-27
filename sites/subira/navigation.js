const toggle = document.querySelector('.menu-toggle');
const navigation = document.getElementById('primary-navigation');
const groups = Array.from(navigation.querySelectorAll('.nav-group'));

function closeGroups(except) {
  groups.forEach((group) => {
    if (group !== except) group.open = false;
  });
}

function setExpanded(expanded) {
  toggle.setAttribute('aria-expanded', String(expanded));
  if (!expanded) closeGroups();
}

toggle.addEventListener('click', () => setExpanded(toggle.getAttribute('aria-expanded') !== 'true'));

groups.forEach((group) => {
  group.querySelector('summary').addEventListener('click', () => {
    if (!group.open) closeGroups(group);
  });
});

document.addEventListener('click', (event) => {
  if (!navigation.contains(event.target)) closeGroups();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const openGroup = groups.find((group) => group.open);
  if (openGroup) {
    openGroup.open = false;
    openGroup.querySelector('summary').focus();
  } else if (toggle.getAttribute('aria-expanded') === 'true') {
    setExpanded(false);
    toggle.focus();
  }
});

navigation.addEventListener('click', (event) => {
  const link = event.target.closest('a');
  if (!link) return;
  setExpanded(false);
  if (link.hash) document.getElementById(link.hash.slice(1))?.focus({ preventScroll: true });
});
toggle.dataset.ready = '';
