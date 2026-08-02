from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0003_order_drop_unique_add_index'),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='pos_error',
            field=models.TextField(blank=True, default=''),
        ),
    ]
