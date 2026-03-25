// performance_group の score は200以上である必要がある
for (const row of tables.performance_group.all()) {
    if (row.score === '') continue;
    assert(Number(row.score) >= 200, `score(${row.score})が200未満です。200以上である必要があります`, row, 'score');
}
