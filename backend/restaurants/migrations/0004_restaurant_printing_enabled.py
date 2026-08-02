from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('restaurants', '0003_restaurant_foodics_branch'),
    ]

    operations = [
        migrations.AddField(
            model_name='restaurant',
            name='printing_enabled',
            field=models.BooleanField(default=False),
        ),
    ]
