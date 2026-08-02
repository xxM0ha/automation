from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('menu', '0004_menuitem_pos_category'),
    ]

    operations = [
        migrations.AddField(
            model_name='menuitemplatform',
            name='pos_category',
            field=models.CharField(blank=True, default='', max_length=200),
        ),
    ]
