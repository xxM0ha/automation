from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('integrations', '0004_pendingmenusync'),
    ]

    operations = [
        migrations.AddField(
            model_name='restaurantplatform',
            name='pos_category',
            field=models.CharField(blank=True, default='', max_length=200),
        ),
    ]
