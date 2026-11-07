// P06 / A3: code served from origin 2 executes in the embedding document of origin 1.
(function () {
  var canvas = document.createElement('canvas');
  var context = canvas.getContext('2d');
  context.fillText('P06 fixture', 1, 12);
  context.getImageData(0, 0, 1, 1);
  canvas.toDataURL();
  window.__realmVendor = { completed: true, calls: 3 };
})();
