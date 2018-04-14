MemsheetApp = {
  list: [],
  create: function(_name) {
    sheet = {
      //sheet: SpreadsheetApp.create(_name),
      name: _name,
      rows: [],
      maxRow: 0,
      maxCol: 0,
      getId: function() {
        return this.sheet.getId();
      },
      getRange: function(col, row) {
        if (!row) {
          row = col.substring(1);
          col = col.substring(0, 1);
        }
        
        if (isNaN(row)) {
          throw new Error("Multicell ranges not supported unless separating col and row in separate parameters");
        }
        
        c = col;
        
        if (typeof col  === "string"){
          c = col.charCodeAt(0) - 65;
        
          // this supports 2 letters in col
          if (col.length > 1) {
            //"AB": 1 * (26) + 1 = 27 
            c = ( (c + 1) * ("Z".charCodeAt(0) - 64)) + (col.charCodeAt(1) - 65);
          }
        }
        
        if (this.maxCol < c) {
          this.maxCol = c;
        }
        r = parseInt(row) - 1;
        if (this.maxRow < r) {
          this.maxRow = r;
        }
        
        if (!this.rows[r]) {
          this.rows[r] = [];
        }
        if (!this.rows[r][c]) {
          this.rows[r][c] = 0;
        }
        
        return {
          rows: this.rows,
          getValue: function() {
            return this.rows[r][c];
          },
          setValue: function(value) {
            this.rows[r][c] = value;
          }
        }
      }
    };
    this.list.push(sheet);
    return sheet;
  },
  flush: function() {
    for (i in this.list) {
      l = this.list[i];
      rowDiff = l.rows.length - Object.keys(l.rows).length;
      if (rowDiff > 0) {
        // insert empty rows at missing row entries
        emptyRow = [];
        for (c = 0; c < l.rows[0].length; c++) {
          emptyRow.push("");
        }
        for (j = 0; j < l.rows.length && rowDiff > 0; j++) {
          if (!l.rows[j]) {
            l.rows[j] = emptyRow;
            rowDiff--;
          }
        }
      }

      l.sheet.getActiveSheet().getRange(1, 1, l.maxRow + 1, l.maxCol + 1).setValues(l.rows);
    }
  }
}
