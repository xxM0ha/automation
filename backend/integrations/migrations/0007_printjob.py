from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('integrations', '0006_webhookrejection'),
        ('orders', '0004_order_pos_error'),
        ('restaurants', '0004_restaurant_printing_enabled'),
    ]

    operations = [
        migrations.CreateModel(
            name='PrintJob',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('printed', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('order', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='print_jobs', to='orders.order')),
                ('restaurant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='print_jobs', to='restaurants.restaurant')),
            ],
            options={'ordering': ['created_at']},
        ),
    ]
