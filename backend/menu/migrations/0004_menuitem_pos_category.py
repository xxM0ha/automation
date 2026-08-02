from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('menu', '0003_menuitemplatformalias'),
    ]

    operations = [
        migrations.AddField(
            model_name='menuitem',
            name='pos_category',
            field=models.CharField(blank=True, default='', max_length=200),
        ),
    ]
