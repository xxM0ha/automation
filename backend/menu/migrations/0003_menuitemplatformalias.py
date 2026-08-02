import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('menu', '0002_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='MenuItemPlatformAlias',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(db_index=True, max_length=200)),
                ('mapping', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='aliases',
                    to='menu.menuitemplatform',
                )),
            ],
            options={
                'unique_together': {('mapping', 'name')},
            },
        ),
    ]
