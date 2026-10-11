from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('menu', '0007_menuitem_foodics_price'),
    ]

    operations = [
        migrations.AddField(
            model_name='menuitem',
            name='foodics_product_id',
            field=models.CharField(blank=True, db_index=True, default='', max_length=64),
        ),
    ]
