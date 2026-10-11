from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('menu', '0006_menuitem_printer'),
    ]

    operations = [
        migrations.AddField(
            model_name='menuitem',
            name='foodics_price',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
    ]
